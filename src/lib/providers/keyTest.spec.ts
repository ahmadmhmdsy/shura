import { describe, expect, it } from "vitest";
import { testProviderKey, setTransportFetch } from "@/lib/transport/transport";

const okCompletion = (text = "جاهز") => ({ choices: [{ message: { role: "assistant", content: text } }], usage: { prompt_tokens: 5, completion_tokens: 1 } });

describe("testProviderKey (بلا شبكة حقيقية)", () => {
  it("نجاح: مفتاح سليم ونداء بسيط يعيد ok=true", async () => {
    setTransportFetch(async () => new Response(JSON.stringify(okCompletion()), { status: 200, headers: { "content-type": "application/json" } }));
    const r = await testProviderKey("minimax", "sk-test", "MiniMax-M2");
    expect(r.ok).toBe(true);
  });

  it("مفتاح غير صالح (401) يعيد ok=false برسالة عربية عن المفتاح", async () => {
    setTransportFetch(async () => new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401, headers: { "content-type": "application/json" } }));
    const r = await testProviderKey("minimax", "sk-bad", "MiniMax-M2");
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/مفتاح/);
  });

  it("فشل شبكة (رفض fetch) يعيد ok=false برسالة عربية عن الشبكة", async () => {
    setTransportFetch(async () => {
      throw new TypeError("fetch failed");
    });
    const r = await testProviderKey("minimax", "sk-test", "MiniMax-M2");
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/شبكة/);
  });

  it("نموذج غير معروف (404) يعيد ok=false برسالة عربية عن النموذج", async () => {
    setTransportFetch(async () => new Response(JSON.stringify({ error: { message: "model not found" } }), { status: 404, headers: { "content-type": "application/json" } }));
    const r = await testProviderKey("minimax", "sk-test", "NO-SUCH-MODEL");
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/نموذج/);
  });
});
