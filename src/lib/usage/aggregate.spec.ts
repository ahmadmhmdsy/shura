import { describe, expect, it } from "vitest";
import { groupByProvider, summarize } from "./aggregate";
import type { UsageEvent } from "@/types";

const ev = (p: Partial<UsageEvent>): UsageEvent => ({ id: "e", sessionId: "s", turnId: "t", ts: 0, providerId: "openrouter", modelId: "m", inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUSD: 0, toolCalls: 0, durationMs: 0, status: "ok", ...p });

const events: UsageEvent[] = [
  ev({ id: "1", providerId: "openrouter", inputTokens: 100, outputTokens: 50, cachedInputTokens: 20, costUSD: 0.01, toolCalls: 1, ts: 10 }),
  ev({ id: "2", providerId: "google", inputTokens: 200, outputTokens: 100, costUSD: 0.02, ts: 20 }),
  ev({ id: "3", providerId: "openrouter", inputTokens: 300, outputTokens: 10, costUSD: 0.03, ts: 30, status: "error" }),
];

describe("aggregate", () => {
  it("الملخص الكلي: مدخلات/مخرجات/كاش/تكلفة/أدوات/نداءات", () => {
    const s = summarize(events);
    expect(s.inputTokens).toBe(600);
    expect(s.outputTokens).toBe(160);
    expect(s.cachedInputTokens).toBe(20);
    expect(s.totalTokens).toBe(760);
    expect(s.costUSD).toBeCloseTo(0.06);
    expect(s.toolCalls).toBe(1);
    expect(s.calls).toBe(3);
  });
  it("تصفية الفترة الزمنية تعمل", () => {
    expect(summarize(events, { fromTs: 20 }).calls).toBe(2);
  });
  it("التجميع حسب المزود يوزع كما هو", () => {
    const g = groupByProvider(events);
    expect(g["openrouter"].calls).toBe(2);
    expect(g["google"].inputTokens).toBe(200);
  });
});
