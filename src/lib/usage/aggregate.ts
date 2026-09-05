import type { UsageEvent } from "@/types";

export interface UsageSummary {
  inputTokens: number; outputTokens: number; cachedInputTokens: number; totalTokens: number;
  costUSD: number; toolCalls: number; calls: number; errors: number;
}

export function summarize(events: readonly UsageEvent[], filter?: { fromTs?: number }): UsageSummary {
  const s: UsageSummary = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, costUSD: 0, toolCalls: 0, calls: 0, errors: 0 };
  for (const e of events) {
    if (filter?.fromTs && e.ts < filter.fromTs) continue;
    s.calls += 1;
    s.inputTokens += e.inputTokens;
    s.outputTokens += e.outputTokens;
    s.cachedInputTokens += e.cachedInputTokens;
    s.costUSD += e.costUSD ?? 0;
    s.toolCalls += e.toolCalls;
    if (e.status === "error") s.errors += 1;
  }
  s.totalTokens = s.inputTokens + s.outputTokens;
  return s;
}

export function groupByProvider(events: readonly UsageEvent[]): Record<string, UsageSummary> {
  const out: Record<string, UsageSummary> = {};
  for (const e of events) {
    (out[e.providerId] ??= { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, costUSD: 0, toolCalls: 0, calls: 0, errors: 0 });
    const g = out[e.providerId];
    g.calls += 1;
    g.inputTokens += e.inputTokens;
    g.outputTokens += e.outputTokens;
    g.cachedInputTokens += e.cachedInputTokens;
    g.costUSD += e.costUSD ?? 0;
    g.toolCalls += e.toolCalls;
    if (e.status === "error") g.errors += 1;
    g.totalTokens = g.inputTokens + g.outputTokens;
  }
  return out;
}
