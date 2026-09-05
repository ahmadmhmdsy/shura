import type { ChatMessage } from "@/types";

export function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / 4);
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
