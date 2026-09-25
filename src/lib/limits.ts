// Hard input ceilings. Every boundary that accepts untrusted text enforces one of
// these before the value reaches storage, a provider, or the disk, so a single runaway
// input cannot exhaust memory, disk, or a paid request.
export const LIMITS = {
  apiKeyMax: 512,
  sharedPromptMax: 100_000,
  customPromptMax: 100_000,
  timeoutMinMs: 10_000,
  timeoutMaxMs: 300_000,
  responseMaxChars: 1_000_000,
  archiveMaxChars: 2_000_000,
} as const;

export function clampTimeoutMs(value: number): number {
  if (!Number.isFinite(value)) return LIMITS.timeoutMinMs;
  return Math.min(LIMITS.timeoutMaxMs, Math.max(LIMITS.timeoutMinMs, Math.round(value)));
}

export function isWithinLimit(text: string, max: number): boolean {
  return text.length <= max;
}

export function limitError(field: string, max: number): string {
  return `${field} يتجاوز الحد المسموح (${max} حرفًا)`;
}
