/**
 * Canonical bounded redaction for every external-error surface (archive, recovery,
 * persistence, UI). Task 9 owns this policy: no second redactor may be created.
 */

import { uiText } from "@/i18n";

const DEFAULT_MAX_CODE_POINTS = 240;

/** [T7.3] أقل طول لقيمة سرّية معروفة يُسمح بحذفها حرفيًا؛ ما دون ذلك كلمة عادية لا سرّ. */
const MIN_SECRET_LENGTH = 8;

/** Counts Unicode code points, never UTF-16 code units, so surrogate pairs stay intact. */
export function codePointLength(value: string): number {
  return [...value].length;
}

/**
 * Deterministic code-point truncation. The marker is always included in the budget.
 * [T3.2a] العلامة تُقرأ وقت الاستدعاء لا وقت الاستيراد، فتتبع لغة الواجهة النشطة.
 */
export function truncateCodePoints(value: string, maxCodePoints: number, marker?: string): string {
  const mark = marker ?? uiText.t("errors.redactionTruncated");
  if (maxCodePoints <= 0) return "";
  const points = [...value];
  const markerPoints = [...mark];
  if (points.length <= maxCodePoints) return value;
  if (markerPoints.length >= maxCodePoints) return points.slice(0, maxCodePoints).join("");
  return points.slice(0, maxCodePoints - markerPoints.length).join("") + mark;
}

/** Only known-safe primitive shapes are converted; nothing else is stringified. */
function safeText(error: unknown): string | null {
  if (typeof error === "string") return error;
  if (typeof error === "number" || typeof error === "boolean") return String(error);
  if (error instanceof Error) return typeof error.message === "string" ? error.message : null;
  return null;
}

// eslint-disable-next-line no-control-regex -- C0/DEL noise must be stripped from stored text.
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

/**
 * [T3.2a] تُبنى القواعد وقت الاستدعاء لأن علامة الحذف تتبع لغة الواجهة النشطة؛ وبناء نسخة
 * جديدة في كل نداء يمنع أيضًا تسرّب `lastIndex` بين الاستدعاءات.
 */
function redactionRules(redacted: string): readonly (readonly [RegExp, string])[] {
  return [
    // Response-body-like JSON/array payloads are dropped, not truncated.
    [/\{[\s\S]*\}/g, " "],
    [/\[[\s\S]*\]/g, " "],
    // Full URLs first: they contain slashes that the path rules would only half-match.
    [/\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+/g, redacted],
    [/\?\S*/g, " "],
    // Windows drive, UNC, POSIX absolute, and home paths.
    [/[A-Za-z]:[\\/][^\s|]*/g, redacted],
    [/\\\\[^\s|]+/g, redacted],
    [/(?:^|\s)\/[^\s|]+/g, " "],
    [/~(?:\/[^\s|]*)?/g, redacted],
    // Credential material.
    [/[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, redacted],
    // [T7.3] صيغ يسمّيها صاحب السياسة: تُحذف أينما ظهرت لأنها تُعرّف نفسها بلا تسمية.
    [/\bAIza[0-9A-Za-z_-]{35}/g, redacted],
    [/\bghp_[A-Za-z0-9]{36}/g, redacted],
    [/\bxoxb-[0-9]+-[0-9]+-[A-Za-z0-9]+/g, redacted],
    [/\bAKIA[0-9A-Z]{16}\b/g, redacted],
    // [T7.3] `\b` قبل `secret` لا يتحقق بعد `_` لأنها حرف كلمة، فالقاعدة العامة كانت تتجاهل
    // `client_secret=` تمامًا؛ هذه القاعدة لا تعتمد على حدّ الكلمة.
    [/(client[_-]?secret)\b\s*[:=]\s*"?[^\s",}]+/gi, "$1=" + redacted],
    [/\bbearer\s+\S+/gi, "Bearer " + redacted],
    [/\b(authorization|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|token|secret|password|passwd)\b\s*[:=]\s*"?[^\s",}]+/gi, "$1=" + redacted],
    [/\bsk-[A-Za-z0-9_-]{8,}/g, redacted],
    [CONTROL_CHARS, " "],
    [/\s+/g, " "],
  ];
}

export interface RedactOptions {
  /** Archive bounds pass an explicit cap; every other boundary uses the 240 default. */
  maxCodePoints?: number;
  /**
   * [T7.3] قيم سرّية معروفة (المفتاح المُختبَر أو المحفوظ) تُحذف حرفيًا قبل القواعد العامة،
   * فمفتاح لا تطابق صيغته أي نمط معروف لا يبقى في النصّ - وهي التغطية التي كانت القاعدة
   * الاستكشافية الخام في `mapProviderError` تقدّمها وقد أُزيلت.
   */
  secrets?: readonly string[];
}

export function redactExternalError(error: unknown, options: RedactOptions = {}): string {
  const max = options.maxCodePoints ?? DEFAULT_MAX_CODE_POINTS;
  const generic = uiText.t("errors.redactionGeneric");
  const raw = safeText(error);
  if (raw === null) return generic;
  let out = raw;
  const marker = uiText.t("errors.redactionMarker");
  // القيم المعروفة أولًا: الحذف الحرفي لا يمكن أن يفشل بسبب صيغة غريبة.
  for (const secret of options.secrets ?? []) {
    if (secret.length >= MIN_SECRET_LENGTH && out.includes(secret)) out = out.split(secret).join(marker);
  }
  for (const [pattern, replacement] of redactionRules(marker)) out = out.replace(pattern, replacement);
  out = out.trim();
  if (!out) return generic;
  return truncateCodePoints(out, max);
}
