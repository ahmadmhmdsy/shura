import { generateText } from "ai";
import { buildLanguageModel } from "./registry";
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

export async function testProviderKey(providerId: ProviderId, apiKey: string, modelId: string): Promise<KeyTestResult> {
  const t0 = Date.now();
  try {
    const model = buildLanguageModel(providerId, apiKey, modelId, getTransportFetch());
    // [إصلاح موثق على كود الخطة] APICallError يشتق isRetryable من الحالة (429=true) فتتكرر المحاولة
    // (2000ms + 4000ms) وتتجاوز مهلة vitest الافتراضية 5000ms — فحص المفتاح نداء واحد حاسم.
    await generateText({ model, prompt: "أجب بكلمة واحدة فقط: جاهز", maxOutputTokens: 20, abortSignal: AbortSignal.timeout(30_000), maxRetries: 0 });
    return { ok: true, detail: "المفتاح يعمل ✓", ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, detail: mapProviderError(e), ms: Date.now() - t0 };
  }
}
