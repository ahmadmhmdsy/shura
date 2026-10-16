import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { LanguageModelUsage } from "ai";
import { dispatchTurn, toUsage } from "./dispatch";
import { ASSUMED_CONTEXT_LIMIT } from "./contextLimit";
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

  // [T2.3/NM-03] نموذج كتالوج مباشر لا صفّ له في السجل الثابت: سعره المنشور يصل في modelInfo
  // المحلول، وكان الحساب يقرأ staticModels وحده فيبقى costUSD null رغم توفّر السعر.
  it("الكلفة من النموذج المحلول: نموذج كتالوج مباشر بسعر منشور يُنتج costUSD غير فارغ", async () => {
    setTransportFetch(sseMockFetch());
    const out = await dispatchTurn({
      ...baseArgs,
      prompts: [{ ...prompts[0], modelId: "meta-llama/llama-3.3-70b-instruct" }],
      modelInfoFor: () => ({
        id: "meta-llama/llama-3.3-70b-instruct",
        label: "Llama 3.3 70B Instruct",
        contextLength: 128000,
        pricing: { inputPerMTok: 0.12, outputPerMTok: 0.3 },
      }),
    });
    // المزود الوهمي يعيد 7 رموز داخلة و3 خارجة؛ السعر 0.12/0.3 لكل مليون رمز.
    const expected = (7 / 1e6) * 0.12 + (3 / 1e6) * 0.3;
    expect(out[0].usage?.costUSD).toBeCloseTo(expected, 12);
  });

  // النقيض: لا سعر منشور ولا صفّ ثابت => يبقى السعر مجهولًا. صفر هنا يخفي فاتورة حقيقية.
  it("بلا سعر منشور ولا صفّ ثابت: costUSD يبقى null لا صفرًا", async () => {
    setTransportFetch(sseMockFetch());
    const out = await dispatchTurn({
      ...baseArgs,
      prompts: [{ ...prompts[0], modelId: "vendor/unpriced-model" }],
      modelInfoFor: () => ({ id: "vendor/unpriced-model", label: "Unpriced", contextLength: 128000, pricing: null }),
    });
    expect(out[0].usage?.costUSD).toBeNull();
  });
  // [T2.9/LV-03] الوصف المحلول لـOpenCode Go بلا سعر (المزود لا ينشره)، والصفّ الثابت كان
  // يخترع 0.6/2.2 فيصل الرقم إلى البطاقة كـ$. بعد الإصلاح يبقى الصفّ الثابت مجهولًا أيضًا.
  it("OpenCode Go بلا سعر منشور: costUSD يبقى null لا رقمًا مُختلقًا", async () => {
    setTransportFetch(sseMockFetch());
    const out = await dispatchTurn({
      ...baseArgs,
      prompts: [{ targetId: "t1", providerId: "opencodego" as const, modelId: "glm-5.3", text: "س1", hasShared: true, hasCustom: false }],
      modelInfoFor: () => ({ id: "glm-5.3", label: "GLM-5.3", pricing: null }),
    });
    expect(out[0].usage?.costUSD).toBeNull();
  });
  // [T2.4/NL-01] الوحدة الوحيدة التي تحوّل استهلاك SDK إلى عقد الاستهلاك المحلي. لا يمكن قياس
  // cacheWriteTokens من طرف المزوّد لأن كلا المزوّدين يثبّت cacheWrite: void 0 (قياس في الحزمة)،
  // فيُقاس التحويل هنا مباشرة: العدد المكتوب يدخل السجل ويدخل حساب الكلفة.
  describe("toUsage", () => {
    const sdk = (o: { input?: number; output?: number; read?: number; write?: number; noCache?: number }): LanguageModelUsage => ({
      inputTokens: o.input,
      outputTokens: o.output,
      totalTokens: o.input === undefined && o.output === undefined ? undefined : (o.input ?? 0) + (o.output ?? 0),
      inputTokenDetails: { noCacheTokens: o.noCache, cacheReadTokens: o.read, cacheWriteTokens: o.write },
      outputTokenDetails: { textTokens: o.output, reasoningTokens: undefined },
    });

    it("يقرأ cacheWriteTokens ويُدخل كلفة الكتابة في الحساب", () => {
      const usage = toUsage(sdk({ input: 100, output: 20, read: 10, write: 40, noCache: 50 }), {
        pricing: { inputPerMTok: 1, outputPerMTok: 2, cacheReadPerMTok: 0.1, cacheWritePerMTok: 1.25 },
      });
      expect(usage.cacheWriteInputTokens).toBe(40);
      expect(usage.cachedInputTokens).toBe(10);
      // غير المُخزَّن = 100 − 10 − 40 = 50؛ والكلفة لكل مليون رمز.
      const expected = (50 * 1 + 10 * 0.1 + 40 * 1.25 + 20 * 2) / 1e6;
      expect(usage.costUSD).toBeCloseTo(expected, 15);
    });

    it("غياب التفاصيل يعني صفرًا لا undefined", () => {
      const usage = toUsage(sdk({ input: 7, output: 3 }), undefined);
      expect(usage.cacheWriteInputTokens).toBe(0);
      expect(usage.cachedInputTokens).toBe(0);
      expect(usage.costUSD).toBeNull();
    });

    // كتابة فعلية بلا سعر كتابة منشور: الكلفة تبقى مجهولة لا منقوصة (حماية من التقليل الصامت).
    it("كتابة بلا سعر كتابة منشور تُبقي الكلفة null", () => {
      const usage = toUsage(sdk({ input: 100, output: 20, write: 40 }), {
        pricing: { inputPerMTok: 1, outputPerMTok: 2 },
      });
      expect(usage.cacheWriteInputTokens).toBe(40);
      expect(usage.costUSD).toBeNull();
    });
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

  // [T2.5/NL-02] البوابة والمقياس على حد واحد: نموذج بلا contextLength يُطبَّق عليه الحد المفترض
  // نفسه الذي يعرضه المقياس (resolveContextLimit)، لا رقمًا مكتوبًا في موضع ثانٍ.
  it("نموذج بلا حد منشور: البوابة تفرض الحد المفترض نفسه", async () => {
    const f = sseMockFetch();
    setTransportFetch(f as unknown as typeof fetch);
    const info = () => ({ id: "vendor/no-limit", label: "No limit" });
    // العتبة المشتقة من الحد المفترض: 128,000 × 0.8 ميزانية = 102,400 رمزًا = 409,600 حرف لاتيني.
    // عند العتبة بالضبط يمر السؤال (الشرط > لا >=)، وبأربعة أحرف فوقها يُرفض قبل أي نداء شبكة.
    const budgetChars = ASSUMED_CONTEXT_LIMIT * 0.8 * 4;
    const under = await dispatchTurn({ ...baseArgs, prompts: [{ ...prompts[0], text: "x".repeat(budgetChars) }], modelInfoFor: info });
    expect(under[0].status).toBe("done");
    const callsAfterUnder = f.calls.length;
    const over = await dispatchTurn({ ...baseArgs, prompts: [{ ...prompts[0], text: "x".repeat(budgetChars + 4) }], modelInfoFor: info });
    // النص المرفوض عام (mapProviderError يطمس رسالة buildContextMessages) فلا يحمل الرقم؛
    // الرقم يظهر في المقياس وحده — وهو سبب وجود T2.5.
    expect(over[0].status).toBe("error");
    expect(over[0].error).toContain("يتجاوز");
    expect(f.calls.length).toBe(callsAfterUnder);
  });

  it("نموذج بلا حد منشور: سؤال عادي يمر بلا حجب", async () => {
    setTransportFetch(sseMockFetch());
    const out = await dispatchTurn({
      ...baseArgs, prompts: [prompts[0]],
      modelInfoFor: () => ({ id: "vendor/no-limit", label: "No limit" }),
    });
    expect(out[0].status).toBe("done");
  });

  // قبل الإصلاح كانت NaN تمر من `?? 128000` (ليست null/undefined) فيرمي buildContextMessages
  // «حد السياق غير صالح» ويسقط الدور بخطأ لا علاقة له بالمزود.
  it("حد مشوّه لا يكسر الدور: يسقط إلى الحد المفترض", async () => {
    setTransportFetch(sseMockFetch());
    const out = await dispatchTurn({
      ...baseArgs, prompts: [prompts[0]],
      modelInfoFor: () => ({ id: "vendor/bad-limit", label: "Bad", contextLength: Number.NaN }),
    });
    expect(out[0].status).toBe("done");
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

  it("مزود يخالف العقد ويعيد نداء أداة لم تُعرض: لا تنفيذ ولا خطأ والنص الجزئي محفوظ (NM-01)", async () => {
    const toolCallSse = [
      'data: ' + JSON.stringify({ choices: [{ delta: { content: "دعني أبحث" } }] }) + '\n\n',
      'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "search_documents", arguments: '{"query":"test"}' } }] } }] }) + '\n\n',
      'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 7, completion_tokens: 3 } }) + '\n\n',
      'data: [DONE]\n\n',
    ].join("");
    let callCount = 0;
    const bodies: string[] = [];
    setTransportFetch((async (_input: RequestInfo | URL, init?: RequestInit) => {
      callCount++;
      bodies.push(String(init?.body ?? ""));
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(toolCallSse)); c.close(); } }), { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch);

    const toolStarts: string[] = [];
    const out = await dispatchTurn({
      ...baseArgs,
      prompts: [prompts[0]],
      multiStepTools: false,
      onToolExecutionStart: (_tid, name) => { toolStarts.push(name); },
    });

    // الأداة لم تُعرض في الطلب، فنداء المزود المخالف لا يُنفَّذ ولا يُفشل الدور:
    // يُحفظ النص الجزئي. (قبل الإصلاح كان الطلب يحمل مخطط الأداة كاملًا.)
    expect(JSON.parse(bodies[0]).tools).toBeUndefined();
    expect(toolStarts).toEqual([]);
    expect(callCount).toBe(1);
    expect(out[0].text).toBe("دعني أبحث");
    expect(out[0].status).toBe("done");
  });

  // NM-01: كان streamText يستلم الأداة دائمًا بينما stopWhen قد تكون isStepCount(1)،
  // فيستدعيها النموذج ولا تعود نتيجتها أبدًا. الشرطان الآن قرار واحد.
  it("لا تُعرض أداة البحث حين تكون الميزانية خطوة واحدة (NM-01)", async () => {
    vi.mocked(createSearchDocumentsTool).mockClear();
    const f = sseMockFetch();
    setTransportFetch(f);

    const out = await dispatchTurn({ ...baseArgs, prompts: [prompts[0]], multiStepTools: false });

    const body = JSON.parse(f.calls[0].body) as { tools?: unknown };
    expect(body.tools).toBeUndefined();
    expect(vi.mocked(createSearchDocumentsTool)).not.toHaveBeenCalled();
    expect(out[0].status).toBe("done");
    expect(out[0].text).toBe("أهلاً");
  });

  it("تُعرض حين تسمح الميزانية بخطوة تستهلك نتيجتها (NM-01)", async () => {
    vi.mocked(createSearchDocumentsTool).mockClear();
    const f = sseMockFetch();
    setTransportFetch(f);

    await dispatchTurn({ ...baseArgs, prompts: [prompts[0]], multiStepTools: true });

    const body = JSON.parse(f.calls[0].body) as { tools?: { function?: { name?: string } }[] };
    expect(body.tools?.map((tool) => tool.function?.name)).toEqual(["search_documents"]);
    expect(vi.mocked(createSearchDocumentsTool)).toHaveBeenCalledTimes(1);
  });

  // [T7.4] الاسترداد الحقيقي: قياس مباشر على ai@7.0.92 (2026-10-12) - إلغاء أثناء خطوة لا
  // يُنتج جزء finish-step ولا يُحسم result.usage (يبقى PENDING)، لكن خطوة اكتملت قبل الإلغاء
  // تبلّغ باستهلاكها في finish-step، فيجب أن يُسترد بدل أن يُسجَّل صفرًا.
  it("إيقاف بعد خطوة مكتملة: استهلاك تلك الخطوة يُسترد بدل صفر (T7.4)", async () => {
    const frame = (delta: unknown): string => "data: " + JSON.stringify({ choices: [{ delta }] }) + "\n\n";
    const toolCallSse = [
      frame({ content: "دعني أبحث" }),
      frame({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "search_documents", arguments: JSON.stringify({ query: "test" }) } }] }),
      "data: " + JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 7, completion_tokens: 3 } }) + "\n\n",
      "data: [DONE]\n\n",
    ].join("");
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream({ start(c) { controller = c; } });
    let calls = 0;
    setTransportFetch((async () => {
      calls++;
      if (calls === 1) return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(toolCallSse)); c.close(); } }), { status: 200, headers: { "content-type": "text/event-stream" } });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch);

    const until = async (fn: () => boolean, what: string): Promise<void> => {
      const end = Date.now() + 4000;
      while (!fn()) { if (Date.now() > end) throw new Error("timeout waiting: " + what); await new Promise((r) => setTimeout(r, 5)); }
    };
    const external = new AbortController();
    const chunks: string[] = [];
    const flow = dispatchTurn({
      ...baseArgs, prompts: [prompts[0]], multiStepTools: true,
      externalSignalFor: () => external.signal,
      onUpdate: (_op, _t, chunk) => { chunks.push(chunk); },
    });
    await until(() => calls === 2, "second step request");
    controller.enqueue(new TextEncoder().encode(frame({ content: "جزء" })));
    await until(() => chunks.length >= 1, "first chunk of the second step");
    external.abort(new Error("ألغي بواسطة المستخدم"));

    const [out] = await flow;
    expect(out.status).toBe("stopped");
    expect(out.usage?.inputTokens).toBe(7);
    expect(out.usage?.outputTokens).toBe(3);
  });

  // [T7.4] maxRetries: 0 سلوك لا نيّة: فشل المزود لا يُعاد فيبقى نداء الشبكة واحدًا.
  it("فشل مزود لا يُعاد: maxRetries صفر يعني نداء شبكة واحدًا (T7.4)", async () => {
    let calls = 0;
    setTransportFetch((async () => { calls++; return new Response("{}", { status: 500 }); }) as unknown as typeof fetch);
    const out = await dispatchTurn({ ...baseArgs, prompts: [prompts[0]] });
    expect(calls).toBe(1);
    expect(out[0].status).toBe("error");
  });
  describe("حالة التفكير (T2.7/LV-02)", () => {
    const frame = (delta: unknown, extra: Record<string, unknown> = {}) => `data: ${JSON.stringify({ choices: [{ delta, ...extra }] })}\n\n`;
    const rawSse = (lines: string[], delayMs = 0): Response => {
      const body = new ReadableStream({
        async start(c) {
          if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
          for (const l of lines) c.enqueue(new TextEncoder().encode(l));
          c.close();
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    };

    it("دلتات reasoning_content تدخل الحالة، وأول دلتا content تخرج منها، والنص لا يختلط بالجواب", async () => {
      setTransportFetch((async () => rawSse([
        frame({ reasoning_content: "أفكر" }),
        frame({ reasoning_content: " طويلًا" }),
        frame({ content: "ok" }),
        frame({}, { finish_reason: "stop" }),
        "data: [DONE]\n\n",
      ])) as typeof fetch);
      const events: { targetId: string; active: boolean }[] = [];
      const out = await dispatchTurn({ ...baseArgs, prompts: [prompts[0]], onReasoning: (_op, targetId, active) => events.push({ targetId, active }) });
      expect(events).toEqual([{ targetId: "t1", active: true }, { targetId: "t1", active: false }]);
      expect(out[0].text).toBe("ok");
      expect(out[0].status).toBe("done");
    });

    it("مزوّد يبلّغ عن رموز تفكير ولا يبثّها: الصمت داخل النافذة يدخل الحالة أيضًا", async () => {
      setTransportFetch((async () => rawSse([
        frame({ content: "ok" }),
        frame({}, { finish_reason: "stop" }),
        "data: [DONE]\n\n",
      ], 1700)) as typeof fetch);
      const events: boolean[] = [];
      const out = await dispatchTurn({ ...baseArgs, prompts: [prompts[0]], onReasoning: (_op, _t, active) => events.push(active) });
      expect(events).toEqual([true, false]);
      expect(out[0].text).toBe("ok");
    }, 15_000);

    it("خطأ منتصف البث يبقى خطأً بعد قراءة fullStream لا done", async () => {
      setTransportFetch((async () => rawSse([
        frame({ content: "ب" }),
        `data: ${JSON.stringify({ error: { message: "boom" } })}\n\n`,
        frame({}, { finish_reason: "stop" }),
      ])) as typeof fetch);
      const out = await dispatchTurn({ ...baseArgs, prompts: [prompts[0]] });
      expect(out[0].status).toBe("error");
      expect(out[0].text).toBe("ب");
    });
  });
});
