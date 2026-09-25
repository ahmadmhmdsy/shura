import { generateText } from "ai";
import { buildLanguageModel, headersFor, getProvider } from "./registry";
import { getTransportFetch } from "@/lib/transport/transport";
import type { ProviderId } from "@/types";

export interface KeyTestResult { ok: boolean; detail: string; ms: number; }

export function mapProviderError(e: unknown): string {
  // [إصلاح موثق على كود الخطة] رسالة SDK قد تكون فارغة (errorToMessage يقرأ error.message من جسم فقير
  // مثل {"error":{}} فيعود undefined → "" )؛ نُحقن statusCode في السلسلة المفحوصة كي تعمل regexات
  // الخطة (401/403/429) كما قُصدت — الرسائل العربية والأنماط نفسها حرفية بلا تغيير.
  const status = (e as { statusCode?: unknown } | null)?.statusCode;
  const msg = (e instanceof Error ? e.message : String(e)) + (typeof status === "number" ? " " + status : "");
  if (/(401|403|invalid|unauthor)/i.test(msg)) return "مفتاح غير صالح أو غير مصرح (401/403)";
  if (/(429|rate)/i.test(msg)) return "تجاوز حد المعدل (429) — انتظر ثم أعد";
  if (/(Failed to fetch|NetworkError|CORS|Load failed)/i.test(msg)) return "تعذر الوصول للمزود (CORS/شبكة) — هذا المزود يتطلب تشغيل شورى كتطبيق سطح مكتب";
  if (/(abort|timeout)/i.test(msg)) return "انتهت المهلة أو أُلغي النداء";
  return msg;
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
  const url = config.keyCheckAuth === "query"
    ? config.keyCheckUrl + "?key=" + encodeURIComponent(apiKey)
    : config.keyCheckUrl;
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
  return { ok: true, detail: "المفتاح يعمل ✓", ms: 0 };
}

export async function testProviderKey(providerId: ProviderId, apiKey: string, modelId: string, sessionId?: string): Promise<KeyTestResult> {
  const t0 = Date.now();
  try {
    const headers = headersFor(providerId, sessionId);
    const listing = await keyListingCheck(providerId, apiKey, headers);
    if (listing === null) {
      await generationCheck(providerId, apiKey, modelId, sessionId);
      return { ok: true, detail: "المفتاح يعمل ✓", ms: Date.now() - t0 };
    }
    if (listing.ok) return { ok: true, detail: "المفتاح يعمل ✓", ms: Date.now() - t0 };
    const detail = mapProviderError(errorWithStatus(listing.status, await listing.text()));
    return { ok: false, detail, ms: Date.now() - t0 };
  } catch (e) {
    // A transport failure on the listing call is not proof of a bad key.
    if (e instanceof Error && /(Failed to fetch|NetworkError|CORS|Load failed)/i.test(e.message)) {
      return { ok: false, detail: mapProviderError(e), ms: Date.now() - t0 };
    }
    try {
      await generationCheck(providerId, apiKey, modelId, sessionId);
      return { ok: true, detail: "المفتاح يعمل ✓", ms: Date.now() - t0 };
    } catch (fallbackError) {
      return { ok: false, detail: mapProviderError(fallbackError), ms: Date.now() - t0 };
    }
  }
}
