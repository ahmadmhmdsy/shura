import type { ModelInfo } from "@/types";

/**
 * [T2.5/NL-02] الحد المفترض حين لا ينشر المزود حدًا صالحًا. رقم واحد يقرأه المقياس والبوابة
 * ومقص السياق معًا؛ كان مكتوبًا في موضع البوابة وحده بينما المقياس يعرض «؟» فلا يفهم المستخدم
 * سبب الرفض.
 */
export const ASSUMED_CONTEXT_LIMIT = 128_000;

export interface ContextLimit {
  /** الحد المطبَّق فعلًا: منشور من المزود أو مفترض. */
  limit: number;
  /** true حين لم ينشر المزود حدًا صالحًا، فلا يجوز عرض الرقم كأنه منشور. */
  assumed: boolean;
}

/**
 * [T2.5/NL-02] مصدر واحد لحد السياق. القيمة المشوّهة (صفر/سالب/NaN/لا نهائي) تُعامل كغياب لا
 * كحد صالح، فلا يسقط الدور بخطأ «حد السياق غير صالح» من داخل buildContextMessages.
 */
export function resolveContextLimit(modelInfo: Pick<ModelInfo, "contextLength">): ContextLimit {
  const published = modelInfo.contextLength;
  if (typeof published === "number" && Number.isFinite(published) && published > 0) {
    return { limit: published, assumed: false };
  }
  return { limit: ASSUMED_CONTEXT_LIMIT, assumed: true };
}
