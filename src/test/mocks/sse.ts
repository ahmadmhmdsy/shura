export function sseResponse(chunks: string[], usage?: { prompt_tokens: number; completion_tokens: number }): Response {
  const lines: string[] = chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`);
  lines.push(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage: usage ?? { prompt_tokens: 7, completion_tokens: 3 } })}\n\n`);
  lines.push("data: [DONE]\n\n");
  const body = new ReadableStream({ start(c) { for (const l of lines) c.enqueue(new TextEncoder().encode(l)); c.close(); } });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

export function sseMockFetch(): typeof fetch & { calls: { url: string; body: string }[] } {
  const calls: { url: string; body: string }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const body = init?.body ?? (input instanceof Request ? await input.clone().text() : "");
    calls.push({ url: String(url), body: String(body) });
    return sseResponse(["أ", "هلاً"]);
  }) as typeof fetch & { calls: typeof calls };
  f.calls = calls;
  return f;
}
