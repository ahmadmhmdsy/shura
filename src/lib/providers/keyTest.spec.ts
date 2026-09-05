import { describe, expect, it } from "vitest";
import { testProviderKey, setTransportFetch } from "@/lib/transport/transport";

const okCompletion = (text = "جاهز") => ({ choices: [{ message: { role: "assistant", content: text } }], usage: { prompt_tokens: 5, completion_tokens: 1 } });

describe("testProviderKey (بلا شبكة حقيقية)", () => {
  it("نجاح: مفتاح سليم ونداء بسيط يعيد ok=true", async () => {
    setTransportFetch(async () => new Response(JSON.stringify(okCompletion()), { status: 200, headers: { "content-type": "application/json" } }));
    const r = await testProviderKey("minimax", "sk-test", "MiniMax-M2");
    expect(r.ok).toBe(true);
  });
  it("401 يُرجم إلى رسالة مفتاح غير صالح", async () => {
    setTransportFetch(async () => new Response(JSON.stringify({ error: {} }), { status: 401 }));
    const r = await testProviderKey("minimax", "bad", "MiniMax-M2");
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/مفتاح/);
  });
  it("429 يُرجم إلى تجاوز الحد", async () => {
    setTransportFetch(async () => new Response("{}", { status: 429 }));
    const r = await testProviderKey("minimax", "k", "MiniMax-M2");
    expect(r.detail).toMatch(/حد|معدل/);
  });
  it("فشل الشبكة (CORS محتمل) يوصي بسطح المكتب", async () => {
    setTransportFetch(async () => { throw new TypeError("Failed to fetch"); });
    const r = await testProviderKey("opencodego", "k", "glm-5.3");
    expect(r.detail).toMatch(/سطح المكتب|CORS/);
  });
});
