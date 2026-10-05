import type { ChatMessage } from "@/types";

// Arabic script Unicode ranges: 0600-06FF, 0750-077F, 08A0-08FF, FB50-FDFF, FE70-FEFF
const ARABIC_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0600, 0x06FF], [0x0750, 0x077F], [0x08A0, 0x08FF], [0xFB50, 0xFDFF], [0xFE70, 0xFEFF],
];

function isArabicChar(char: string): boolean {
  const code = char.codePointAt(0)!;
  return ARABIC_RANGES.some(([lo, hi]) => code >= lo && code <= hi);
}

/**
 * Token estimate that accounts for script. Arabic tokenizes at ~2.5 chars/token
 * while Latin tokenizes at ~4 chars/token. Mixed text is weighted by proportion.
 *
 * This is the single source of truth for token estimation in the app: the context
 * gate (lib/chat/context), the context meter (features/chat/ContextMeter), and the
 * RAG chunker (lib/rag/chunker) all read from here so the number the user sees and
 * the number the enforcer uses can never disagree.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let arabic = 0;
  let latin = 0;
  for (const char of text) {
    if (isArabicChar(char)) arabic++;
    else if (/[\p{L}\p{N}]/u.test(char)) latin++;
  }
  const total = arabic + latin;
  if (total === 0) return Math.ceil(text.length / 4);
  return Math.ceil((arabic / total) * (total / 2.5) + (latin / total) * (total / 4));
}

export function estimateSessionTokens(messages: readonly Pick<ChatMessage, "text">[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.text), 0);
}

export type ContextLevel = "ok" | "warn" | "danger";

export function contextPercent(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

export function contextLevel(used: number, limit: number): ContextLevel {
  const pct = contextPercent(used, limit);
  if (pct >= 95) return "danger";
  if (pct >= 80) return "warn";
  return "ok";
}
