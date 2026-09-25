import type { UsageEvent } from "@/types";

export interface UsageSummary {
  inputTokens: number; outputTokens: number; cachedInputTokens: number; totalTokens: number;
  /** null means "at least one included call has no known cost"; it is never rounded to zero. */
  costUSD: number | null; toolCalls: number; calls: number; errors: number;
}

function isKnownCost(cost: number | null | undefined): cost is number {
  return typeof cost === "number" && Number.isFinite(cost);
}

// Summing unknowns as zero silently understates the bill, so a single unknown cost
// makes the whole aggregate unknown and the UI shows a dash instead.
function sumCosts(costs: readonly (number | null | undefined)[]): number | null {
  if (costs.length === 0) return 0;
  let total = 0;
  for (const cost of costs) {
    if (!isKnownCost(cost)) return null;
    total += cost;
  }
  return total;
}

export function summarize(events: readonly UsageEvent[], filter?: { fromTs?: number }): UsageSummary {
  const s: UsageSummary = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, costUSD: 0, toolCalls: 0, calls: 0, errors: 0 };
  const costs: (number | null | undefined)[] = [];
  for (const e of events) {
    if (filter?.fromTs && e.ts < filter.fromTs) continue;
    s.calls += 1;
    s.inputTokens += e.inputTokens;
    s.outputTokens += e.outputTokens;
    s.cachedInputTokens += e.cachedInputTokens;
    costs.push(e.costUSD);
    s.toolCalls += e.toolCalls;
    if (e.status === "error") s.errors += 1;
  }
  s.totalTokens = s.inputTokens + s.outputTokens;
  s.costUSD = sumCosts(costs);
  return s;
}

export function groupByProvider(events: readonly UsageEvent[]): Record<string, UsageSummary> {
  const out: Record<string, UsageSummary> = {};
  const costs: Record<string, (number | null | undefined)[]> = {};
  for (const e of events) {
    out[e.providerId] ??= { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, costUSD: 0, toolCalls: 0, calls: 0, errors: 0 };
    costs[e.providerId] ??= [];
    const g = out[e.providerId];
    g.calls += 1;
    g.inputTokens += e.inputTokens;
    g.outputTokens += e.outputTokens;
    g.cachedInputTokens += e.cachedInputTokens;
    costs[e.providerId].push(e.costUSD);
    g.toolCalls += e.toolCalls;
    if (e.status === "error") g.errors += 1;
    g.totalTokens = g.inputTokens + g.outputTokens;
  }
  for (const [providerId, providerCosts] of Object.entries(costs)) out[providerId].costUSD = sumCosts(providerCosts);
  return out;
}
