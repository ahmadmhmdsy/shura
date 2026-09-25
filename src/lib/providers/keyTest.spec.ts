import { describe, expect, it } from "vitest";
import { testProviderKey, setTransportFetch } from "@/lib/transport/transport";

const okCompletion = (text = "جاهز") => ({ choices: [{ message: { role: "assistant", content: text } }], usage: { prompt_tokens: 5, completion_tokens: 1 } });

const completionResponse = () => new Response(JSON.stringify(okCompletion()), { status: 200, headers: { "content-type": "application/json" } });

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

  // فحص المفتاح بلا ترويسة الجلسة لا يثبت ما يثبته طلب حقيقي، فيفشل على OpenCode Go.
  it("sends the same OpenCode session header as a real request", async () => {
    const seen: Array<{ url: string; headers: Headers }> = [];
    setTransportFetch(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      seen.push({ url: request.url, headers: new Headers(request.headers) });
      return completionResponse();
    });

    const r = await testProviderKey("opencodego", "sk-test", "glm-5.3", "s1");

    expect(r.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].headers.get("x-opencode-session")).toBe("s1");
  });

  it("works without a session id and never sends an empty header", async () => {
    const seen: Headers[] = [];
    setTransportFetch(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      seen.push(new Headers(request.headers));
      return completionResponse();
    });

    const r = await testProviderKey("opencodego", "sk-test", "glm-5.3");

    expect(r.ok).toBe(true);
    expect(seen[0].get("x-opencode-session")).toBeNull();
  });

  it("does not leak the api key into the error detail", async () => {
    setTransportFetch(async () => new Response("{}", { status: 401 }));
    const r = await testProviderKey("minimax", "sk-super-secret-value", "MiniMax-M2");
    expect(r.detail).not.toContain("sk-super-secret-value");
  });
});

describe('testProviderKey does not consume generation quota', () => {
  it('makes only a non-generating key call, never chat completions', async () => {
    const urls: string[] = [];
    setTransportFetch(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      urls.push(request.url);
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const r = await testProviderKey('minimax', 'sk-test', 'MiniMax-M2');

    expect(r.ok).toBe(true);
    expect(urls).toHaveLength(1);
    expect(urls[0]).not.toMatch(/chat\/completions/);
  });

  it('passes a Google key as a query parameter, not a header', async () => {
    const urls: string[] = [];
    setTransportFetch(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      urls.push(request.url);
      return new Response(JSON.stringify({ models: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const r = await testProviderKey('google', 'AIza-test', 'gemini-2.5-pro');

    expect(r.ok).toBe(true);
    expect(urls[0]).toMatch(/key=AIza-test/);
  });

  it('falls back to a generation call when the provider has no key endpoint', async () => {
    let calls = 0;
    setTransportFetch(async (input, init) => {
      calls += 1;
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url.includes('/models')) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(okCompletion()), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const r = await testProviderKey('opencodego', 'sk-test', 'glm-5.3');

    expect(r.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('a 429 on the key endpoint is reported as a rate limit, not a bad key', async () => {
    setTransportFetch(async () => new Response('{}', { status: 429 }));
    const r = await testProviderKey('minimax', 'k', 'MiniMax-M2');
    expect(r.detail).toMatch(/حد|معدل/);
  });
});
