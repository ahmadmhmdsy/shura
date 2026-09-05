import { describe, expect, it } from "vitest";
import { getProvider, listProviderIds, computeCost, buildLanguageModel } from "./registry";

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
    expect(p.defaultHeaders?.["HTTP-Referer"]).toBeTruthy();
  });
  it("opencodego على بوابة zen/go مع دعم جلسة", () => {
    const p = getProvider("opencodego");
    expect(p.baseURL).toBe("https://opencode.ai/zen/go/v1");
    expect(p.sessionHeaderName).toBe("x-opencode-session");
  });
  it("مزود مجهول يرمي خطأ واضحًا", () => {
    expect(() => getProvider("nonexistent" as never)).toThrow(/مزود غير معروف/);
  });
  it("computeCost يحسب من أسعار الموديل", () => {
    const cost = computeCost({ inputTokens: 1_000_000, outputTokens: 1_000_000, cachedInputTokens: 0 }, { pricing: { inputPerMTok: 1, outputPerMTok: 2 } });
    expect(cost).toBeCloseTo(3);
  });
  it("computeCost يعيد null بلا تسعير", () => {
    expect(computeCost({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 }, { pricing: null })).toBeNull();
  });
  it("buildLanguageModel يبني موديل openai-compatible لكل مزود وgoogle خاصًا", () => {
    const m1 = buildLanguageModel("openrouter", "KEY", "gpt-4o", async () => new Response());
    const m2 = buildLanguageModel("google", "KEY", "gemini-2.5-pro", async () => new Response());
    expect(m1 && m2).toBeTruthy();
  });
  it("buildLanguageModel بلا مفتاح يرمي خطأ عربيًا", () => {
    expect(() => buildLanguageModel("minimax", "", "MiniMax-M2", async () => new Response())).toThrow(/مفتاح/);
  });
});
