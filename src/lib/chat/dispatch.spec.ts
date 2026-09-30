import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { dispatchTurn } from "./dispatch";
import { sseMockFetch, sseResponse } from "@/test/mocks/sse";
import { setTransportFetch } from "@/lib/transport/transport";
import { createSearchDocumentsTool } from "@/lib/rag/tool";
import type { ChatMessage } from "@/types";

vi.mock("@/lib/rag/tool", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rag/tool")>();
  return {
    ...actual,
    createSearchDocumentsTool: vi.fn(actual.createSearchDocumentsTool),
  };
});

const prompts = [
  { targetId: "t1", providerId: "openrouter" as const, modelId: "openai/gpt-4o", text: "س1", hasShared: true, hasCustom: false },
  { targetId: "t2", providerId: "minimax" as const, modelId: "MiniMax-M2", text: "س2", hasShared: false, hasCustom: true },
];

const baseArgs = {
  operationId: "op1",
  sessionId: "s",
  turnId: "turn1",
  apiKeyFor: () => "k",
  sessionHeaderFor: () => ({}),
  timeoutMs: 5000,
  contextMode: "stateful" as const,
  multiStepTools: false,
  modelInfoFor: (targetId: string) => {
    if (targetId === "t1") return { id: "openai/gpt-4o", label: "GPT-4o", contextLength: 128_000 };
    if (targetId === "t2") return { id: "MiniMax-M2", label: "MiniMax M2", contextLength: 204_800 };
    return { id: "unknown", label: "Unknown" };
  },
  historyFor: (): readonly ChatMessage[] => [],
};

const row = (o: Partial<ChatMessage>): ChatMessage => ({
  id: o.id ?? "m" + Math.random().toString(36).slice(2),
  sessionId: o.sessionId ?? "s",
  turnId: o.turnId ?? "tr",
  createdAt: o.createdAt ?? 0,
  role: o.role ?? "user",
  kind: o.kind ?? "prompt",
  text: o.text ?? "",
  status: o.status ?? "done",
  ...o,
});

describe("dispatchTurn", () => {
  it("بث متوازٍ لهدفين: النص الكامل يُجمع لكل هدف", async () => {
    setTransportFetch(sseMockFetch());
    const out = await dispatchTurn({ ...baseArgs, prompts });
    expect(out.map((r) => r.targetId).sort()).toEqual(["t1", "t2"]);
    expect(out.every((r) => r.status === "done" && r.text === "أهلاً")).toBe(true);
  });
  it("عزل الأخطاء: هدف يفشل 401 والبقية تكتمل", async () => {
    const f = sseMockFetch();
    setTransportFetch(((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("minimax")) return new Response("{}", { status: 401 });
      return f(input, init);
    }) as typeof fetch);
    const out = await dispatchTurn({ ...baseArgs, prompts });
    const t2 = out.find((r) => r.targetId === "t2")!;
    expect(t2.status).toBe("error");
    expect(t2.error).toMatch(/مفتاح/);
    expect(out.find((r) => r.targetId === "t1")!.status).toBe("done");
  });
  it("تسجيل الاستهلاك: usage يُقرأ من النهاية ويُحسب مثله", async () => {
    setTransportFetch(sseMockFetch());
    const out = await dispatchTurn({ ...baseArgs, prompts: [prompts[0]] });
    expect(out[0].usage?.inputTokens).toBe(7);
    expect(out[0].usage?.outputTokens).toBe(3);
    expect(out[0].usage?.costUSD).not.toBeNull();
    expect(out[0].status).toBe("done");
  });
  it("مهلة قصيرة جدا تُلغي الهدف", async () => {
    setTransportFetch((() => new Promise<Response>(() => {})) as typeof fetch);
    const out = await dispatchTurn({ ...baseArgs, prompts: [prompts[0]], timeoutMs: 50 });
    expect(out[0].status).toBe("error");
    expect(out[0].error).toMatch(/مهلة|ألغي/);
  });

  it("stateful: يرسل التاريخ الكامل للجلسة بجوار السؤال الحالي", async () => {
    const f = sseMockFetch();
    setTransportFetch(f as unknown as typeof fetch);
    const hi: ChatMessage[] = [
      row({ id: "a", turnId: "tr", role: "user", text: "س-سابق", createdAt: 1 }),
      row({ id: "b", turnId: "tr", role: "assistant", text: "ج-سابق", createdAt: 2 }),
    ];
    const out = await dispatchTurn({
      ...baseArgs, prompts: [prompts[0]],
      historyFor: () => hi,
    });
    expect(out[0].status).toBe("done");
    const body = JSON.parse(f.calls[0].body) as { messages: { role: string; content: string }[]; prompt?: unknown };
    expect(body.messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "س-سابق"],
      ["assistant", "ج-سابق"],
      ["user", "س1"],
    ]);
    expect(body.prompt).toBeUndefined();
  });

  it("stateless: السؤال الحالي فقط يُرسل للمزود", async () => {
    const f = sseMockFetch();
    setTransportFetch(f as unknown as typeof fetch);
    const hi: ChatMessage[] = [
      row({ id: "a", turnId: "tr", role: "user", text: "س-سابق", createdAt: 1 }),
      row({ id: "b", turnId: "tr", role: "assistant", text: "ج-سابق", createdAt: 2 }),
    ];
    const out = await dispatchTurn({
      ...baseArgs, prompts: [prompts[0]],
      contextMode: "stateless",
      historyFor: () => hi,
    });
    expect(out[0].status).toBe("done");
    const body = JSON.parse(f.calls[0].body) as { messages: { role: string; content: string }[]; prompt?: unknown };
    expect(body.messages).toEqual([{ role: "user", content: "س1" }]);
    expect(body.prompt).toBeUndefined();
  });

  it("stateful: يستثني تدفقات جلسة أخرى من السياق المرسل", async () => {
    const f = sseMockFetch();
    setTransportFetch(f as unknown as typeof fetch);
    const hi: ChatMessage[] = [
      row({ id: "a", sessionId: "s", turnId: "tr", role: "user", text: "س-لنا", createdAt: 1 }),
      row({ id: "b", sessionId: "s", turnId: "tr", role: "assistant", text: "ج-لنا", createdAt: 2 }),
      row({ id: "c", sessionId: "other", turnId: "tr2", role: "user", text: "س-عابرة", createdAt: 3 }),
      row({ id: "d", sessionId: "other", turnId: "tr2", role: "assistant", text: "ج-عابرة", createdAt: 4 }),
    ];
    const out = await dispatchTurn({
      ...baseArgs, prompts: [prompts[0]],
      historyFor: () => hi,
    });
    expect(out[0].status).toBe("done");
    const body = JSON.parse(f.calls[0].body) as { messages: { role: string; content: string }[]; prompt?: unknown };
    expect(body.messages.map((m) => m.content)).toEqual(["س-لنا", "ج-لنا", "س1"]);
    expect(body.prompt).toBeUndefined();
  });

  it("لا نداء شبكة حين يتجاوز السياق حد النموذج: فشل عادي بلا onUpdate", async () => {
    const f = sseMockFetch();
    setTransportFetch(f as unknown as typeof fetch);
    const updates: string[] = [];
    const out = await dispatchTurn({
      ...baseArgs, prompts: [{ ...prompts[0], text: "س".repeat(410) }],
      modelInfoFor: () => ({ id: "openai/gpt-4o", label: "GPT-4o", contextLength: 128 }),
      onUpdate: (_opId, targetId, chunk) => updates.push(targetId + ":" + chunk),
    });
    updates.push("sentinel");
    expect(f.calls).toEqual([]);
    expect(out[0].status).toBe("error");
    expect(typeof out[0].error).toBe("string");
    expect(out[0].error).toContain("يتجاوز");
    expect(out[0].text).toBe("");
    expect(updates).toEqual(["sentinel"]);
  });

  it("تجاوز السياق ينظف المؤقت بعد الفشل: صفر مؤقتات معلقة مجدولة", async () => {
    vi.useFakeTimers();
    try {
      setTransportFetch(sseMockFetch());
      const external = new AbortController();
      const out = await dispatchTurn({
        ...baseArgs,
        prompts: [{ ...prompts[0], text: "س".repeat(410) }],
        modelInfoFor: () => ({ id: "openai/gpt-4o", label: "GPT-4o", contextLength: 128 }),
        externalSignalFor: () => external.signal,
      });
      expect(out[0].status).toBe("error");
      expect(out[0].error).toContain("يتجاوز");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("تمرير عمليات: onUpdate/onStatus تصل بمعرف العملية ومعرف الهدف", async () => {
    setTransportFetch(sseMockFetch());
    const ops: [string, string, string][] = [];
    const statuses: [string, string, string, string | undefined][] = [];
    const out = await dispatchTurn({
      ...baseArgs, prompts: prompts,
      onUpdate: (operationId, targetId, chunk) => ops.push([operationId, targetId, chunk]),
      onStatus: (operationId, targetId, status, error) => statuses.push([operationId, targetId, status, error]),
      historyFor: (id) => (id === "t1" ? [row({ id: "a", turnId: "tr", role: "user", text: "س-سابق", createdAt: 1 }), row({ id: "b", turnId: "tr", role: "assistant", text: "ج-سابق", createdAt: 2 })] : []),
    });
    const t1ok = out.find((r) => r.targetId === "t1")!;
    const t2ok = out.find((r) => r.targetId === "t2")!;
    expect(t1ok.status).toBe("done");
    expect(t2ok.status).toBe("done");
    expect(ops.filter(([o, t]) => o === "op1" && t === "t1").length).toBeGreaterThan(0);
    expect(ops.filter(([o, t]) => o === "op1" && t === "t2").length).toBeGreaterThan(0);
    expect(ops.every(([o]) => o === "op1")).toBe(true);
    expect(statuses.length).toBeGreaterThanOrEqual(2);
    expect(statuses.filter(([, t, s]) => t === "t1" && s === "streaming").length).toBe(1);
    expect(statuses.filter(([, t, s]) => t === "t1" && s === "done").length).toBe(1);
    expect(statuses.filter(([, t, s, e]) => t === "t2" && s === "streaming" && e === undefined).length).toBe(1);
    expect(statuses.filter(([, t, s]) => t === "t2" && s === "done").length).toBe(1);
    expect(statuses.every(([o]) => o === "op1")).toBe(true);
  });

  it("multi-step: النموذج يستدعي search_documents ثم يجيب بنتائجها", async () => {
    const toolCallSse = [
      'data: ' + JSON.stringify({ choices: [{ delta: { content: "دعني أبحث" } }] }) + '\n\n',
      'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "search_documents", arguments: '{"query":"test"}' } }] } }] }) + '\n\n',
      'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 7, completion_tokens: 3 } }) + '\n\n',
      'data: [DONE]\n\n',
    ].join("");
    let callCount = 0;
    setTransportFetch((async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(toolCallSse)); c.close(); } }), { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return sseResponse(["الإجابة"]);
    }) as unknown as typeof fetch);

    const toolStarts: string[] = [];
    const toolEnds: string[] = [];
    const out = await dispatchTurn({
      ...baseArgs,
      prompts: [prompts[0]],
      multiStepTools: true,
      onToolExecutionStart: (_tid, name) => { toolStarts.push(name); },
      onToolExecutionEnd: (_tid, name) => { toolEnds.push(name); },
    });

    expect(callCount).toBe(2);
    expect(toolStarts).toEqual(["search_documents"]);
    expect(toolEnds).toEqual(["search_documents"]);
    expect(out[0].status).toBe("done");
    expect(out[0].text).toContain("الإجابة");
  });

  it("خطأ الأداة: onToolExecutionError يُطلق عند رمي الأداة خطأ", async () => {
    vi.mocked(createSearchDocumentsTool).mockImplementationOnce(() => ({
      description: "mock tool",
      inputSchema: z.object({ query: z.string() }),
      execute: async () => { throw new Error("فشل البحث في المستندات"); },
    }) as never);

    const toolCallSse = [
      'data: ' + JSON.stringify({ choices: [{ delta: { content: "دعني أبحث" } }] }) + '\n\n',
      'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "search_documents", arguments: '{"query":"test"}' } }] } }] }) + '\n\n',
      'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 7, completion_tokens: 3 } }) + '\n\n',
      'data: [DONE]\n\n',
    ].join("");
    let callCount = 0;
    setTransportFetch((async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(toolCallSse)); c.close(); } }), { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return sseResponse(["الإجابة"]);
    }) as unknown as typeof fetch);

    const toolErrors: [string, string, string][] = [];
    const toolEnds: string[] = [];
    const out = await dispatchTurn({
      ...baseArgs,
      prompts: [prompts[0]],
      multiStepTools: true,
      onToolExecutionError: (_tid, toolName, error) => { toolErrors.push([_tid, toolName, error]); },
      onToolExecutionEnd: (_tid, name) => { toolEnds.push(name); },
    });

    expect(callCount).toBe(2);
    expect(toolErrors.length).toBe(1);
    expect(toolErrors[0][0]).toBe("t1");
    expect(toolErrors[0][1]).toBe("search_documents");
    expect(toolErrors[0][2]).toContain("فشل البحث");
    expect(toolEnds).toEqual(["search_documents"]);
    expect(out[0].status).toBe("done");
    expect(out[0].text).toContain("الإجابة");
  });

  it("single-step: النموذج يستدعي الأداة لكن البث يتوقف بعد خطوة واحدة", async () => {
    const toolCallSse = [
      'data: ' + JSON.stringify({ choices: [{ delta: { content: "دعني أبحث" } }] }) + '\n\n',
      'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "search_documents", arguments: '{"query":"test"}' } }] } }] }) + '\n\n',
      'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 7, completion_tokens: 3 } }) + '\n\n',
      'data: [DONE]\n\n',
    ].join("");
    let callCount = 0;
    setTransportFetch((async () => {
      callCount++;
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(toolCallSse)); c.close(); } }), { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch);

    const out = await dispatchTurn({
      ...baseArgs,
      prompts: [prompts[0]],
      multiStepTools: false,
    });

    expect(callCount).toBe(1);
    expect(out[0].text).toBe("دعني أبحث");
  });
});
