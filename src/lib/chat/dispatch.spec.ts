import { describe, expect, it } from "vitest";
import { dispatchTurn } from "./dispatch";
import { sseMockFetch } from "@/test/mocks/sse";
import { setTransportFetch } from "@/lib/transport/transport";

const prompts = [
  { targetId: "t1", providerId: "openrouter" as const, modelId: "openai/gpt-4o", text: "س1", hasShared: true, hasCustom: false },
  { targetId: "t2", providerId: "minimax" as const, modelId: "MiniMax-M2", text: "س2", hasShared: false, hasCustom: true },
];

describe("dispatchTurn", () => {
  it("بث متوازٍ لهدفين: النص الكامل يُجمع لكل هدف", async () => {
    setTransportFetch(sseMockFetch());
    const out = await dispatchTurn({ sessionId: "s", turnId: "turn1", prompts, apiKeyFor: () => "k", sessionHeaderFor: () => ({}), timeoutMs: 5000 });
    expect(out.map((r) => r.targetId).sort()).toEqual(["t1", "t2"]);
    expect(out.every((r) => r.ok && r.text === "أهلاً")).toBe(true);
  });
  it("عزل الأخطاء: هدف يفشل 401 والبقية تكتمل", async () => {
    const f = sseMockFetch();
    setTransportFetch(((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("minimax")) return new Response("{}", { status: 401 });
      return f(input, init);
    }) as typeof fetch);
    const out = await dispatchTurn({ sessionId: "s", turnId: "turn1", prompts, apiKeyFor: () => "k", sessionHeaderFor: () => ({}), timeoutMs: 5000 });
    const t2 = out.find((r) => r.targetId === "t2")!;
    expect(t2.ok).toBe(false);
    expect(t2.error).toMatch(/مفتاح/);
    expect(out.find((r) => r.targetId === "t1")!.ok).toBe(true);
  });
  it("تسجيل الاستهلاك: usage يُقرأ من النهاية ويُحسب مثله", async () => {
    setTransportFetch(sseMockFetch());
    const out = await dispatchTurn({ sessionId: "s", turnId: "turn1", prompts: [prompts[0]], apiKeyFor: () => "k", sessionHeaderFor: () => ({}), timeoutMs: 5000 });
    expect(out[0].usage?.inputTokens).toBe(7);
    expect(out[0].usage?.outputTokens).toBe(3);
    expect(out[0].usage?.costUSD).not.toBeNull();
  });
  it("مهلة قصيرة جدا تُلغي الهدف", async () => {
    setTransportFetch((() => new Promise<Response>(() => {})) as typeof fetch);
    const out = await dispatchTurn({ sessionId: "s", turnId: "turn1", prompts: [prompts[0]], apiKeyFor: () => "k", sessionHeaderFor: () => ({}), timeoutMs: 50 });
    expect(out[0].ok).toBe(false);
    expect(out[0].error).toMatch(/مهلة|ألغي/);
  });
});
