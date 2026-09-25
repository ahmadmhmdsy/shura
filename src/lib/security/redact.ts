/**
 * Canonical bounded redaction for every external-error surface (archive, recovery,
 * persistence, UI). Task 9 owns this policy: no second redactor may be created.
 */

const DEFAULT_MAX_CODE_POINTS = 240;
const TRUNCATION_MARKER = "… [مقتطع]";
const GENERIC_ERROR = "خطأ خارجي غير محدد";
const REDACTED = "[محذوف]";

/** Counts Unicode code points, never UTF-16 code units, so surrogate pairs stay intact. */
export function codePointLength(value: string): number {
  return [...value].length;
}

/** Deterministic code-point truncation. The marker is always included in the budget. */
export function truncateCodePoints(value: string, maxCodePoints: number, marker = TRUNCATION_MARKER): string {
  if (maxCodePoints <= 0) return "";
  const points = [...value];
  const markerPoints = [...marker];
  if (points.length <= maxCodePoints) return value;
  if (markerPoints.length >= maxCodePoints) return points.slice(0, maxCodePoints).join("");
  return points.slice(0, maxCodePoints - markerPoints.length).join("") + marker;
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

const REPLACED: readonly [RegExp, string][] = [
  // Response-body-like JSON/array payloads are dropped, not truncated.
  [/\{[\s\S]*\}/g, " "],
  [/\[[\s\S]*\]/g, " "],
  // Full URLs first: they contain slashes that the path rules would only half-match.
  [/\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+/g, REDACTED],
  [/\?\S*/g, " "],
  // Windows drive, UNC, POSIX absolute, and home paths.
  [/[A-Za-z]:[\\/][^\s|]*/g, REDACTED],
  [/\\\\[^\s|]+/g, REDACTED],
  [/(?:^|\s)\/[^\s|]+/g, " "],
  [/~(?:\/[^\s|]*)?/g, REDACTED],
  // Credential material.
  [/[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, REDACTED],
  [/\bbearer\s+\S+/gi, "Bearer " + REDACTED],
  [/\b(authorization|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|token|secret|password|passwd)\b\s*[:=]\s*"?[^\s",}]+/gi, "$1=" + REDACTED],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, REDACTED],
  [CONTROL_CHARS, " "],
  [/\s+/g, " "],
];

export interface RedactOptions {
  /** Archive bounds pass an explicit cap; every other boundary uses the 240 default. */
  maxCodePoints?: number;
}

export function redactExternalError(error: unknown, options: RedactOptions = {}): string {
  const max = options.maxCodePoints ?? DEFAULT_MAX_CODE_POINTS;
  const raw = safeText(error);
  if (raw === null) return GENERIC_ERROR;
  let out = raw;
  for (const [pattern, replacement] of REPLACED) out = out.replace(pattern, replacement);
  out = out.trim();
  if (!out) return GENERIC_ERROR;
  return truncateCodePoints(out, max);
}
