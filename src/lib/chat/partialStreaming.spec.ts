import { describe, expect, it, vi } from "vitest";
import { dispatchTurn } from "./dispatch";
import { setTransportFetch } from "@/lib/transport/transport";
import type { ChatMessage } from "@/types";

/** بث SSE قابل للتحكم: كل مكعب يُدفع يدويًا حتى نستطيع الإلغاء بعد أول مكعب حتميًا */
type StreamHandle = {
  fetch: typeof fetch;
  enqueue(chunk: string): void;
  error(e: unknown): void;
  close(): void;
  ready: Promise<void>;
};

function controllableSseStream(): StreamHandle {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let ready!: (v: void) => void;
  const readyP = new Promise<void>((r) => { ready = r; });
  const body = new ReadableStream({
    start(c) { controller = c; ready(); },
  });
  const enc = new TextEncoder();
  const line = (o: unknown): Uint8Array => enc.encode(`data: ${JSON.stringify(o)}\n\n`);
  const handle: StreamHandle = {
    fetch: (async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })) as typeof fetch,
    enqueue(chunk) { controller.enqueue(line({ choices: [{ delta: { content: chunk } }] })); },
    error(e) { controller.error(e); },
    close() {
      controller.enqueue(line({ choices: [{ delta: {} }], usage: { prompt_tokens: 7, completion_tokens: 3 } }));
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    },
    ready: readyP,
  };
  return handle;
}

const prompt = (text = "س1") => ({ targetId: "t1", providerId: "openrouter" as const, modelId: "openai/gpt-4o", text, hasShared: true, hasCustom: false });

const baseArgs = {
  operationId: "op-partial",
  sessionId: "s1",
  turnId: "t1",
  apiKeyFor: () => "k",
  sessionHeaderFor: () => ({}),
  contextMode: "stateful" as const,
  modelInfoFor: () => ({ id: "openai/gpt-4o", label: "GPT-4o", contextLength: 128_000 }),
  historyFor: (): readonly ChatMessage[] => [],
};

const waitFor = async (fn: () => boolean, what: string): Promise<void> => {
  const deadline = Date.now() + 5000;
  while (!fn()) {
    if (Date.now() > deadline) throw new Error("timeout waiting: " + what);
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe("dispatchTurn partial streaming", () => {
  it("normal completion: done with full text, usage, operationId", async () => {
    const s = controllableSseStream();
    setTransportFetch(s.fetch);
    const updates: { op: string; target: string; chunk: string }[] = [];
    const flow = dispatchTurn({ ...baseArgs, prompts: [prompt()], onUpdate: (op, target, chunk) => updates.push({ op, target, chunk }) });
    await s.ready;
    s.enqueue("بداية");
    await waitFor(() => updates.length === 1, "first chunk");
    s.enqueue("تكملة");
    await waitFor(() => updates.length === 2, "second chunk");
    s.close();
    const [out] = await flow;
    expect(out).toMatchObject({ targetId: "t1", operationId: "op-partial", status: "done" });
    expect(out.text).toBe("بدايةتكملة");
    expect(out.usage?.inputTokens).toBe(7);
    expect(Array.from(new Set(updates.map((u) => u.op)))).toEqual(["op-partial"]);
  });

  it("user abort after first chunk: stopped with accumulated text", async () => {
    const s = controllableSseStream();
    setTransportFetch(s.fetch);
    const external = new AbortController();
    const updates: string[] = [];
    const flow = dispatchTurn({ ...baseArgs, prompts: [prompt()], externalSignalFor: () => external.signal, onUpdate: (_op, _t, chunk) => updates.push(chunk) });
    await s.ready;
    s.enqueue("بداية");
    await waitFor(() => updates.length === 1, "first chunk");
    external.abort(new Error("ألغي بواسطة المستخدم"));
    const [out] = await flow;
    expect(out.status).toBe("stopped");
    expect(out.text).toBe("بداية");
    expect(out.operationId).toBe("op-partial");
    expect(updates).toEqual(["بداية"]);
    s.close();
  });

  it("timeout after first chunk: error with accumulated partial text", async () => {
    const s = controllableSseStream();
    setTransportFetch(s.fetch);
    const updates: string[] = [];
    const flow = dispatchTurn({ ...baseArgs, prompts: [prompt()], timeoutMs: 80, onUpdate: (_op, _t, chunk) => updates.push(chunk) });
    await s.ready;
    s.enqueue("بداية");
    await waitFor(() => updates.length === 1, "first chunk");
    const [out] = await flow;
    expect(out.status).toBe("error");
    expect(out.text).toBe("بداية");
    expect(typeof out.error).toBe("string");
    expect(updates).toEqual(["بداية"]);
    s.close();
  });

  it("provider failure after first chunk: error with accumulated partial text", async () => {
    const s = controllableSseStream();
    setTransportFetch(s.fetch);
    const updates: string[] = [];
    const flow = dispatchTurn({ ...baseArgs, prompts: [prompt()], onUpdate: (_op, _t, chunk) => updates.push(chunk) });
    await s.ready;
    s.enqueue("بداية");
    await waitFor(() => updates.length === 1, "first chunk");
    s.error(new Error("ECONNRESET"));
    const [out] = await flow;
    expect(out.status).toBe("error");
    expect(out.text).toBe("بداية");
    expect(out.operationId).toBe("op-partial");
    expect(updates).toEqual(["بداية"]);
  });

  it("callback text matches outcome text prefix at every step", async () => {
    const s = controllableSseStream();
    setTransportFetch(s.fetch);
    const updates: string[] = [];
    const flow = dispatchTurn({ ...baseArgs, prompts: [prompt()], onUpdate: (_op, _t, chunk) => updates.push(chunk) });
    await s.ready;
    s.enqueue("أ");
    await waitFor(() => updates.length === 1, "first chunk");
    s.enqueue("هلاً");
    await waitFor(() => updates.length === 2, "second chunk");
    s.close();
    const [out] = await flow;
    expect(out.status).toBe("done");
    expect(updates.join("")).toBe(out.text);
  });
});