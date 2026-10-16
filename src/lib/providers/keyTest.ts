import { generateText } from "ai";
import { buildLanguageModel, headersFor, getProvider } from "./registry";
import { getTransportFetch } from "@/lib/transport/transport";
import { uiText } from "@/i18n";
import { isKeyedError } from "@/lib/errors/keyedError";
import { redactExternalError } from "@/lib/security/redact";
import type { ProviderId } from "@/types";

export interface KeyTestResult { ok: boolean; detail: string; ms: number; }

export function mapProviderError(e: unknown, secret?: string): string {
  // [T3.2c] خطأ مُفتَّح من طبقة المجال يُترجَم بمفتاحه: كان هذا الموضع يفحص رسالة
  // `context.ts` العربية بنمط نصّي، فكان تغيير صياغة الرسالة يكسر الترجمة صامتًا.
  if (isKeyedError(e)) return uiText.t(e.key, e.args);
  // [إصلاح موثق على كود الخطة] رسالة SDK قد تكون فارغة (errorToMessage يقرأ error.message من جسم فقير
  // مثل {"error":{}} فيعود undefined → "" )؛ نُحقن statusCode في السلسلة المفحوصة كي تعمل regexات
  // الخطة (401/403/429) كما قُصدت — الأنماط العربية المطابقة لرسائل المزودين باقية كما هي،
  // ومخرجات الترجمة صارت موارد ([T3.2c]) بدل نصوص مكتوبة هنا.
  const status = (e as { statusCode?: unknown } | null)?.statusCode;
  const msg = (e instanceof Error ? e.message : String(e)) + (typeof status === "number" ? " " + status : "");
  if (/(401|403|invalid|unauthor)/i.test(msg)) return uiText.t("errors.providerUnauthorized");
  if (/(429|rate)/i.test(msg)) return uiText.t("errors.providerRateLimited");
  if (/(Failed to fetch|NetworkError|CORS|Load failed)/i.test(msg)) return uiText.t("errors.providerUnreachable");
  if (/(abort|timeout)/i.test(msg)) return uiText.t("errors.providerTimeout");
  // [L2] Arabic error patterns for providers that return Arabic messages.
  // Note: Order matters — check context overflow before rate limit to avoid false matches.
  if (/(مفتاح غير صالح|غير مصرح|مصادقة)/.test(msg)) return uiText.t("errors.providerUnauthorized");
  if (/(تجاوز حد السياق|السؤال الحالي يتجاوز)/.test(msg)) return uiText.t("errors.providerContextOverflow");
  if (/(تجاوز حد المعدل|المعدل|طلبات كثيرة)/.test(msg)) return uiText.t("errors.providerRateLimited");
  if (/(تعذر الوصول|شبكة|اتصال)/.test(msg)) return uiText.t("errors.providerUnreachable");
  if (/(انتهت المهلة|أُلغي|إلغاء)/.test(msg)) return uiText.t("errors.providerTimeout");
  // [T7.3] مُنقّي واحد فقط لهذه السياسة (`redact.ts:2-4`). الحذف الاستكشافي المحلي أُزيل:
  // كان يمحو تفاصيل مفيدة (معرّف طلب طويل) ويمرّر مفاتيح حقيقية (مفتاح AWS بطول 20 محرفًا)،
  // ويخالف ملكية واحدة للسياسة. ويُمرَّر المفتاح المُختبَر ليُحذف حرفيًا مهما كانت صيغته.
  return redactExternalError(msg, secret ? { secrets: [secret] } : {});
}

function errorWithStatus(status: number, body: string): Error {
  return Object.assign(new Error(body.slice(0, 400)), { statusCode: status });
}

/**
 * Proves a key is accepted using a free listing endpoint.
 *
 * Validating a key by generating text is wrong: it spends the user quota, and a provider
 * that rate-limits generation answers 429 for a perfectly valid key, which is exactly the
 * false negative this function used to produce. A listing call costs nothing and is not
 * metered, so a 429 here genuinely means the limit was reached rather than that the key
 * is bad.
 */
async function keyListingCheck(providerId: ProviderId, apiKey: string, headers: Record<string, string>): Promise<Response | null> {
  const config = getProvider(providerId);
  if (!config.keyCheckUrl) return null;
  let url = config.keyCheckUrl;
  if (config.keyCheckAuth === "query") {
    const withKey = new URL(config.keyCheckUrl);
    withKey.searchParams.set("key", apiKey);
    url = withKey.toString();
  }
  const init = new Headers(headers);
  if (config.keyCheckAuth !== "query") init.set("Authorization", "Bearer " + apiKey);
  const response = await getTransportFetch()(url, { method: "GET", headers: init, signal: AbortSignal.timeout(15_000) });
  // A provider without a listing endpoint is not a failure; the caller falls back.
  if (response.status === 404 || response.status === 405 || response.status === 501) return null;
  return response;
}

async function generationCheck(providerId: ProviderId, apiKey: string, modelId: string, sessionId?: string): Promise<KeyTestResult> {
  const model = buildLanguageModel(providerId, apiKey, modelId, getTransportFetch(), headersFor(providerId, sessionId));
  await generateText({ model, prompt: "أجب بكلمة واحدة فقط: جاهز", maxOutputTokens: 20, abortSignal: AbortSignal.timeout(30_000), maxRetries: 0 });
  return { ok: true, detail: uiText.t("errors.keyWorks"), ms: 0 };
}

export async function testProviderKey(providerId: ProviderId, apiKey: string, modelId: string, sessionId?: string): Promise<KeyTestResult> {
  const t0 = Date.now();
  try {
    const headers = headersFor(providerId, sessionId);
    const listing = await keyListingCheck(providerId, apiKey, headers);
    if (listing === null) {
      await generationCheck(providerId, apiKey, modelId, sessionId);
      return { ok: true, detail: uiText.t("errors.keyWorks"), ms: Date.now() - t0 };
    }
    if (listing.ok) return { ok: true, detail: uiText.t("errors.keyWorks"), ms: Date.now() - t0 };
    const detail = mapProviderError(errorWithStatus(listing.status, await listing.text()), apiKey);
    return { ok: false, detail, ms: Date.now() - t0 };
  } catch (e) {
    // [T2.6/NL-03] لا نداء توليد ثانٍ. كتلة catch تحيط بنداء القائمة **وبنداء التوليد الاحتياطي معًا**،
    // فكل ما يصل إليها إما فشل شبكي على القائمة (يُبلَّغ كما هو: سطح المكتب/CORS) أو فشل حتمي من نداء
    // التوليد نفسه (401/429 مثلًا)؛ وإعادة التوليد تكرّر الفشل ذاته وتستهلك الحصة بلا معلومة جديدة.
    return { ok: false, detail: mapProviderError(e, apiKey), ms: Date.now() - t0 };
  }
}
