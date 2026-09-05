import { APICallError, generateText } from "ai";
import { buildLanguageModel, getProvider } from "@/lib/providers/registry";
import type { FetchLike } from "@/lib/providers/registry";
import type { ProviderId } from "@/types";

// طبقة النقل الواحدة (مواصفة التصميم 4.3): كل نداءات المزودين تمر عبر fetch قابل
// للاستبدال — داخل المتصفح fetch الأصلي، وفي Tauri يعاض بـ fetch إضافة http (المهمة 14).

let transportFetch: FetchLike = globalThis.fetch;

export function setTransportFetch(fetchImpl: FetchLike): void {
  transportFetch = fetchImpl;
}

export function getTransportFetch(): FetchLike {
  return transportFetch;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const NETWORK_HINTS = /fetch failed|network|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|EPROTO|certificate|Undici/i;

/** يحول أخطاء SDK/الشبكة إلى رسائل عربية قابلة للعرض مباشرة في البطاقات. */
export function mapProviderError(err: unknown): string {
  if (APICallError.isInstance(err)) {
    const status = err.statusCode;
    if (status === 401 || status === 403) return "مفتاح API غير صالح أو مرفوض من المزود — تحقق من المفتاح في الإعدادات";
    if (status === 404) return "النموذج غير معروف عند المزود — تحقق من اسم الموديل";
    if (status === 429) return "تجاوزت حد الطلبات لدى المزود — أعد المحاولة بعد قليل";
    if (status != null && status >= 500) return "خطأ من جهة المزود — أعد المحاولة لاحقًا";
    return "رفض المزود النداء (HTTP " + String(status ?? "?") + "): " + err.message;
  }
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) return "ألغي النداء";
  const msg = err instanceof Error ? err.message : String(err);
  const causeMsg = err instanceof Error && err.cause instanceof Error ? " " + err.cause.message : "";
  if (NETWORK_HINTS.test(msg + " " + causeMsg)) return "تعذر الوصول إلى المزود (مشكلة شبكة) — تحقق من اتصالك بالإنترنت";
  return "تعذر إكمال النداء: " + msg;
}

export interface CallModelOptions {
  signal?: AbortSignal;
}

/** نداء واحد غير متدفق عبر AI SDK فوق طبقة النقل؛ يرمي خطأ برسالة عربية معروضة (mapProviderError). */
export async function callModel(providerId: ProviderId, apiKey: string, modelId: string, prompt: string, opts?: CallModelOptions): Promise<string> {
  // مفتاح فارغ: يخرج من buildLanguageModel بخطأه العربي الأصلي (خارج try كي لا يُغلف مرتين)
  const model = buildLanguageModel(providerId, apiKey, modelId, getTransportFetch());
  try {
    // maxRetries: 0 — نداء حتمي سريع بلا إعادة محاولة صامتة (لازمان اختبار مفاتيح متوقع)
    const { text } = await generateText({ model, prompt, abortSignal: opts?.signal, maxRetries: 0 });
    return text;
  } catch (e) {
    throw new Error(mapProviderError(e), { cause: e });
  }
}

export interface KeyTestResult {
  ok: boolean;
  detail: string;
}

const KEY_TEST_PROMPT = "أجب بكلمة واحدة فقط: جاهز";

/** يجرب المفتاح فعليًا بنداء رخيص واحد عبر callModel — بلا شبكة حقيقية في الاختبارات (fetch المعترض). */
export async function testProviderKey(providerId: ProviderId, apiKey: string, modelId: string): Promise<KeyTestResult> {
  try {
    const text = await callModel(providerId, apiKey, modelId, KEY_TEST_PROMPT);
    return { ok: true, detail: "المفتاح يعمل — اتصال ناجح مع " + getProvider(providerId).label + ". رد الموديل: " + text };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
