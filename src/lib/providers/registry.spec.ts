import { describe, expect, it } from "vitest";
import { getProvider, listProviderIds, computeCost, buildLanguageModel, headersFor } from "./registry";

// toBeCloseTo compares to two decimal places by default, which hides every real
// difference in per-token costs, so cost assertions use a relative tolerance.
const expectNear = (actual: number | null, expected: number) => {
  expect(actual).not.toBeNull();
  expect(Math.abs((actual as number) - expected) / expected).toBeLessThan(1e-9);
};

describe("provider registry", () => {
  it("يعرّف المزودين الأربعة بالضبط", () => {
    expect(listProviderIds().sort()).toEqual(["google", "minimax", "opencodego", "openrouter"]);
  });
  it("openrouter بلا قيود متصفح وMiniMax مفتوح وOpenCode Go محجوب", () => {
    expect(getProvider("openrouter").browserDirect).toBe(true);
    expect(getProvider("minimax").browserDirect).toBe(true);
    expect(getProvider("google").browserDirect).toBe(true);
    expect(getProvider("opencodego").browserDirect).toBe(false);
  });
  it("openrouter على قاعدته الصحيحة مع ترويسات هوية التطبيق", () => {
    const p = getProvider("openrouter");
    expect(p.baseURL).toBe("https://openrouter.ai/api/v1");
    expect(p.defaultHeaders?.["HTTP-Referer"]).toBe("http://localhost:5173");
  });
  it("opencodego على بوابة zen/go مع دعم جلسة", () => {
    const p = getProvider("opencodego");
    expect(p.baseURL).toBe("https://opencode.ai/zen/go/v1");
    expect(p.sessionHeaderName).toBe("x-opencode-session");
  });
  it("مزود مجهول يرمي خطأ واضحًا", () => {
    expect(() => getProvider("nonexistent" as never)).toThrow(/مزود مجهول|مزود غير معروف/);
  });
  it("computeCost يحسب من أسعار الموديل", () => {
    expectNear(computeCost({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, { pricing: { inputPerMTok: 1, outputPerMTok: 2 } }), 3);
  });
  it("computeCost يعيد null بلا تسعير", () => {
    expect(computeCost({ inputTokens: 10, outputTokens: 5 }, { pricing: null })).toBeNull();
  });
  it("buildLanguageModel يبني موديل openai-compatible لكل مزود وgoogle خاصًا", () => {
    const m1 = buildLanguageModel("openrouter", "KEY", "gpt-4o", async () => new Response());
    const m2 = buildLanguageModel("google", "KEY", "gemini-2.5-pro", async () => new Response());
    expect(m1 && m2).toBeTruthy();
  });
  it("buildLanguageModel بلا مفتاح يرمي خطأ عربيًا", () => {
    expect(() => buildLanguageModel("minimax", "", "MiniMax-M2", async () => new Response())).toThrow(/مفتاح/);
  });

  it("uses cache-read pricing", () => {
    expectNear(computeCost(
      { inputTokens: 100, outputTokens: 20, cachedInputTokens: 80, cacheWriteInputTokens: 0 },
      { pricing: { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2 } },
    ), 0.000256);
  });

  it("separates cache-write pricing from uncached input", () => {
    expectNear(computeCost(
      { inputTokens: 100, outputTokens: 0, cachedInputTokens: 20, cacheWriteInputTokens: 30 },
      { pricing: { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2, cacheWritePerMTok: 2.5 } },
    ), 0.000179);
  });

  it("never invents a cache-read price that the provider did not publish", () => {
    expect(computeCost(
      { inputTokens: 100, outputTokens: 20, cachedInputTokens: 80, cacheWriteInputTokens: 0 },
      { pricing: { inputPerMTok: 2, outputPerMTok: 10 } },
    )).toBeNull();
  });

  it("never invents a cache-write price when the provider does not report one", () => {
    expect(computeCost(
      { inputTokens: 100, outputTokens: 20, cachedInputTokens: 0, cacheWriteInputTokens: 40 },
      { pricing: { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2 } },
    )).toBeNull();
  });

  it("clamps negative token counts instead of reporting a negative cost", () => {
    expectNear(computeCost(
      { inputTokens: -5, outputTokens: 10, cachedInputTokens: 0, cacheWriteInputTokens: 0 },
      { pricing: { inputPerMTok: 2, outputPerMTok: 10 } },
    ), 0.0001);
  });

  it("sends the OpenCode session header during key testing", () => {
    expect(headersFor("opencodego", "s1")).toEqual({ "x-opencode-session": "s1" });
  });

  it("keeps provider headers and adds no session header without a contract", () => {
    expect(headersFor("openrouter")["X-Title"]).toBe("Shura");
    expect(Object.keys(headersFor("openrouter")).some((name) => name.toLowerCase() === "x-opencode-session")).toBe(false);
    expect(headersFor("opencodego")).toEqual({});
  });

  it("omits an empty or blank session id", () => {
    expect(headersFor("opencodego", "")).toEqual({});
    expect(headersFor("opencodego", "   ")).toEqual({});
  });
});
