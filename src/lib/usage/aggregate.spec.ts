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

  // تكلفة غير معروفة ليست صفرًا: تلخيصها صفرٌ يجعل الفاتورة تبدو كاملة وهي ناقصة.
  it("keeps unknown aggregate cost unknown", () => {
    expect(summarize([ev({ costUSD: null })]).costUSD).toBeNull();
  });

  it("null cost among known costs stays unknown", () => {
    expect(summarize([ev({ id: "1", costUSD: 0.01 }), ev({ id: "2", costUSD: null })]).costUSD).toBeNull();
  });

  it("a non-finite cost is unknown, not zero", () => {
    expect(summarize([ev({ costUSD: Number.NaN })]).costUSD).toBeNull();
    expect(summarize([ev({ costUSD: Number.POSITIVE_INFINITY })]).costUSD).toBeNull();
  });

  it("no events means no cost, not unknown", () => {
    expect(summarize([]).costUSD).toBe(0);
  });

  it("a filtered-out unknown event does not poison the included total", () => {
    const s = summarize([ev({ id: "1", costUSD: 0.02, ts: 30 }), ev({ id: "2", costUSD: null, ts: 10 })], { fromTs: 20 });
    expect(s.costUSD).toBeCloseTo(0.02);
  });

  it("groups an unknown provider cost as unknown", () => {
    const g = groupByProvider([ev({ id: "1", costUSD: 0.01 }), ev({ id: "2", costUSD: null })]);
    expect(g["openrouter"].costUSD).toBeNull();
    expect(g["openrouter"].calls).toBe(2);
  });

  it("known provider groups still sum", () => {
    const g = groupByProvider(events);
    expect(g["openrouter"].costUSD).toBeCloseTo(0.04);
    expect(g["google"].costUSD).toBeCloseTo(0.02);
  });
});
