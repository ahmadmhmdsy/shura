import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatScreen } from "./ChatScreen";
import { useSessionsStore } from "@/state/sessionsStore";
import { useComposerStore } from "@/state/composerStore";
import { useSettingsStore } from "@/state/settingsStore";
import { setTransportFetch } from "@/lib/transport/transport";
import { sessionOperationCoordinator } from "@/lib/chat/operationCoordinator";
import { toast } from "sonner";
import { sseMockFetch, sseResponse } from "@/test/mocks/sse";
import { createSession, getMessages, getSession, getTurn, getUsageEvents, putTurn } from "@/lib/db/repos";
import { memoryFileSink, setFileSink, type FileSink } from "@/lib/markdown/sink";
import type { TargetConfig, ChatMessage, SessionMeta } from "@/types";

// خطاف أخطاء داخلية معتمد للاختبارات: appendMessage الحقيقي يمرّ عبره دائمًا،
// ويمكن للاختبار أن يجعل النداء رقم N يفشل لمحاكاة خطأ طبقة تخزين داخلية.
const reposHook = vi.hoisted(() => ({
  appendCalls: 0,
  streamingCalls: 0,
  failOnCall: 0,
  failFinal: false,
  holdOnCall: 0,
  holdGate: null as Promise<void> | null,
  holdFinalSummary: false,
  failFinalSummary: false,
  holdUsage: false,
  failUsage: false,
  failWarning: false,
  usageGate: null as Promise<void> | null,
  onUsageStart: null as (() => void) | null,
  onHoldStart: null as (() => void) | null,
  holdSessionUpdate: false,
  sessionUpdateGate: null as Promise<void> | null,
  onSessionUpdateStart: null as (() => void) | null,
}));
vi.mock("@/lib/db/repos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/repos")>();
  const realAppend = actual.appendMessage;
  return {
    ...actual,
    updateTurnAttemptStatus: async (...args: Parameters<typeof actual.updateTurnAttemptStatus>) => {
      summaryAttemptHook.calls += 1;
      if (summaryAttemptHook.failCount > 0) {
        summaryAttemptHook.failCount -= 1;
        throw new Error("فشل تحديث محاولة الخلاصة");
      }
      return actual.updateTurnAttemptStatus(...args);
    },
    updateSessionIfOperation: async (...args: Parameters<typeof actual.updateSessionIfOperation>) => {
      if (reposHook.holdSessionUpdate && args[2].onDiskDir !== undefined && reposHook.sessionUpdateGate) {
        reposHook.onSessionUpdateStart?.();
        await reposHook.sessionUpdateGate;
      }
      return actual.updateSessionIfOperation(...args);
    },
    recordUsage: async (event: Parameters<typeof actual.recordUsage>[0]) => {
      if (reposHook.failUsage) throw new Error("فشل الاستهلاك");
      if (reposHook.holdUsage && reposHook.usageGate) {
        reposHook.onUsageStart?.();
        await reposHook.usageGate;
      }
      return actual.recordUsage(event);
    },
    appendMessage: async (msg: ChatMessage, canAppend?: () => boolean) => {
      reposHook.appendCalls += 1;
      if (msg.status === "streaming") reposHook.streamingCalls += 1;
      const holdFinalSummary = reposHook.holdFinalSummary && msg.kind === "synthesis" && msg.status !== "streaming";
      if (reposHook.holdOnCall > 0 && reposHook.appendCalls === reposHook.holdOnCall && reposHook.holdGate) {
        reposHook.onHoldStart?.();
        await reposHook.holdGate;
      } else if (holdFinalSummary && reposHook.holdGate) {
        reposHook.holdFinalSummary = false;
        reposHook.onHoldStart?.();
        await reposHook.holdGate;
      }
      if (reposHook.failWarning && msg.sidecarWarning) throw new Error("فشل حفظ تحذير sidecar");
      const failFinalSummary = reposHook.failFinalSummary && msg.kind === "synthesis" && msg.status !== "streaming";
      if (failFinalSummary) reposHook.failFinalSummary = false;
      if ((reposHook.failOnCall > 0 && reposHook.appendCalls === reposHook.failOnCall) || (reposHook.failFinal && msg.role === "assistant" && msg.status !== "streaming") || failFinalSummary) throw new Error("فشل تخزين داخلي");
      return realAppend(msg, canAppend);
    },
  };
});

const summaryAttemptHook = vi.hoisted(() => ({ failCount: 0, calls: 0 }));
const summaryDispatchHook = vi.hoisted(() => ({
  forceStatus: null as "done" | "stopped" | "error" | null,
  forceError: undefined as string | undefined,
  forceOperationId: undefined as string | undefined,
  forceTargetId: undefined as string | undefined,
  forceEmpty: false,
  onResolved: null as (() => void) | null,
}));
vi.mock("@/lib/chat/dispatch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat/dispatch")>();
  return {
    ...actual,
    dispatchTurn: async (args: Parameters<typeof actual.dispatchTurn>[0]) => {
      const outcomes = await actual.dispatchTurn(args);
      summaryDispatchHook.onResolved?.();
      if (summaryDispatchHook.forceEmpty) return [];
      const [head, ...tail] = outcomes;
      if (!head) return outcomes;
      return [{
        ...head,
        status: summaryDispatchHook.forceStatus ?? head.status,
        ...(summaryDispatchHook.forceOperationId === undefined ? {} : { operationId: summaryDispatchHook.forceOperationId }),
        ...(summaryDispatchHook.forceTargetId === undefined ? {} : { targetId: summaryDispatchHook.forceTargetId }),
        ...(summaryDispatchHook.forceError === undefined ? {} : { error: summaryDispatchHook.forceError }),
      }, ...tail];
    },
  };
});

let n = 0;
async function mkSession(over: Partial<SessionMeta> = {}): Promise<SessionMeta> {
  n += 1;
  const s: SessionMeta = { id: "cs" + n, title: "جلسة", createdAt: Date.now(), updatedAt: Date.now(), modelIds: [], primaryTarget: null, layoutMode: "vertical", onDisk: false, ...over };
  await createSession(s);
  return s;
}

const TWO: TargetConfig[] = [
  { targetId: "t1", providerId: "openrouter", modelId: "openai/gpt-4o", modelInfo: { id: "openai/gpt-4o", label: "GPT-4o" } },
  { targetId: "t2", providerId: "minimax", modelId: "MiniMax-M2", modelInfo: { id: "MiniMax-M2", label: "MiniMax M2" } },
];
const ONE: TargetConfig[] = [{ targetId: "t1", providerId: "openrouter", modelId: "openai/gpt-4o", modelInfo: { id: "openai/gpt-4o", label: "GPT-4o" } }];

function seed(session: SessionMeta, opts: { targets?: TargetConfig[]; prompt?: string } = {}): void {
  useSessionsStore.setState({ sessions: [session], currentId: session.id, messages: [] });
  useSettingsStore.setState({ providerKeys: { openrouter: "k", minimax: "k" }, timeoutMs: 5000 });
  // معرفات أهداف فريدة لكل اختبار: عمليات إرسال سابقة معلقة (مؤقتات مهلة) قد تكمل بعد انتهاء
  // اختبارها وتكتب في المخزن العام — التفرد يمنع التطابق الخاطئ في مسار الدلتا الاحتياطي.
  const targets = (opts.targets ?? TWO).map((t) => ({ ...t, targetId: t.targetId + "_" + session.id }));
  useComposerStore.setState({ drafts: { [session.id]: { targets, syncMode: true, sharedPrompt: opts.prompt ?? "س1", customs: {}, focusTargetId: null } } });
}

function doneTurn(session: SessionMeta): ChatMessage[] {
  const turnId = `tr-${session.id}`;
  return [
    { id: "m1", sessionId: session.id, turnId, createdAt: 1, role: "user", kind: "prompt", text: "س1", promptKind: "shared", status: "done" },
    { id: "m2", sessionId: session.id, turnId, createdAt: 2, role: "assistant", kind: "result", text: "جواب", providerId: "openrouter", modelId: "openai/gpt-4o", targetId: "t1", status: "done" },
    { id: "m3", sessionId: session.id, turnId, createdAt: 3, role: "assistant", kind: "result", text: "جواب", providerId: "minimax", modelId: "MiniMax-M2", targetId: "t2", status: "done" },
  ];
}

const realPatchMessage = useSessionsStore.getState().patchMessage;
const realUpsertMessagesLocal = useSessionsStore.getState().upsertMessagesLocal;

async function settleOperations(): Promise<void> {
  await act(async () => {
    await sessionOperationCoordinator.waitForIdle();
  });
}

async function runToIdle(trigger: () => void): Promise<void> {
  await act(async () => {
    trigger();
    await sessionOperationCoordinator.waitForIdle();
  });
}

beforeEach(() => {
  // A thrown patch mock can be copied into a later Zustand state object; restore the real
  // observer before each test so the persistence regressions do not leak across cases.
  useSessionsStore.setState({ patchMessage: realPatchMessage, upsertMessagesLocal: realUpsertMessagesLocal });
  // Reset the module-global sink between tests without changing production APIs.
  setFileSink(null as unknown as FileSink);
  setTransportFetch(sseMockFetch());
  reposHook.appendCalls = 0;
  reposHook.streamingCalls = 0;
  reposHook.failOnCall = 0;
  reposHook.failFinal = false;
  reposHook.holdOnCall = 0;
  reposHook.holdGate = null;
  reposHook.holdFinalSummary = false;
  reposHook.failFinalSummary = false;
  reposHook.holdUsage = false;
  reposHook.failUsage = false;
  reposHook.failWarning = false;
  reposHook.usageGate = null;
  reposHook.onUsageStart = null;
  reposHook.onHoldStart = null;
  reposHook.holdSessionUpdate = false;
  reposHook.sessionUpdateGate = null;
  reposHook.onSessionUpdateStart = null;
  summaryAttemptHook.failCount = 0;
  summaryAttemptHook.calls = 0;
  summaryDispatchHook.forceStatus = null;
  summaryDispatchHook.forceError = undefined;
  summaryDispatchHook.forceOperationId = undefined;
  summaryDispatchHook.forceTargetId = undefined;
  summaryDispatchHook.forceEmpty = false;
  summaryDispatchHook.onResolved = null;
});

afterEach(async () => {
  const sessions = useSessionsStore.getState().sessions;
  await act(async () => {
    for (const session of sessions) sessionOperationCoordinator.cancel(session.id);
    await sessionOperationCoordinator.waitForIdle();
  });
  cleanup();
  setFileSink(null as unknown as FileSink);
  vi.restoreAllMocks();
});

describe("ChatScreen — التوصيل الحي", () => {
  it("الإرسال يبث حيًا: السؤال يظهر وبطاقتان بالنص النهائي", async () => {
    const s = await mkSession();
    seed(s);
    render(<ChatScreen session={s} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /إرسال/ }));
      await sessionOperationCoordinator.waitForIdle();
    });
    expect(await screen.findAllByText("أهلاً", {}, { timeout: 3000 })).toHaveLength(2);
    // «س1» يظهر في الاقتباس وفي قيمة الـ textarea (React يعرض القيمة كمحتوى) — نكفي بوجوده
    expect(screen.getAllByText("س1").length).toBeGreaterThan(0);
  });

  it("التبديل عمودي/أفقي يُحفظ في Dexie ومخزن الجلسات", async () => {
    const s = await mkSession();
    seed(s);
    useSessionsStore.setState({ messages: doneTurn(s) });
    render(<ChatScreen session={s} />);
    expect(screen.getByRole("button", { name: /أفقي/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /أفقي/ }));
    await waitFor(() => expect(useSessionsStore.getState().sessions.find((x) => x.id === s.id)?.layoutMode).toBe("horizontal"));
    expect((await getSession(s.id))?.layoutMode).toBe("horizontal");
  });

  it("الإيقاف أثناء البث يجعل البطاقتين «أُوقف» لا «خطأ»", async () => {
    let hangCalls = 0;
    const hangFetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      hangCalls += 1;
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const rejectOnAbort = (): void => reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
        if (signal?.aborted) rejectOnAbort();
        else signal?.addEventListener("abort", rejectOnAbort, { once: true });
      });
    }) as unknown as typeof fetch;
    setTransportFetch(hangFetch);
    const s = await mkSession();
    seed(s);
    render(<ChatScreen session={s} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /إرسال/ }));
      await vi.waitFor(() => expect(hangCalls).toBe(2), { timeout: 3000 });
      // البطاقتان أثناء البث تضيفان زرّي إيقاف (aria-label «إيقاف») — زر الإيقاف العام هو الأخير في DOM
      const stops = screen.getAllByRole("button", { name: /إيقاف/ });
      fireEvent.click(stops[stops.length - 1]);
      await sessionOperationCoordinator.waitForIdle();
    });
    expect(await screen.findAllByText("أُوقف", {}, { timeout: 3000 })).toHaveLength(2);
  });

  it("لا يوقف Stop النتيجة النهائية أثناء انتظار sidecars", async () => {
    let release!: () => void;
    const usageGate = new Promise<void>((resolve) => { release = resolve; });
    let usageStarted!: () => void;
    const usageStartedPromise = new Promise<void>((resolve) => { usageStarted = resolve; });
    reposHook.holdUsage = true;
    reposHook.usageGate = usageGate;
    reposHook.onUsageStart = usageStarted;
    setTransportFetch((() => sseResponse(["done"])) as unknown as typeof fetch);
    const s = await mkSession();
    seed(s, { targets: ONE });
    render(<ChatScreen session={s} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /إرسال/ }));
      await usageStartedPromise;
      await vi.waitFor(async () => {
        const row = (await getMessages(s.id)).find((message) => message.role === "assistant");
        expect(row?.status).toBe("done");
      }, { timeout: 3000 });
      const stop = screen.getByRole("button", { name: /إيقاف/ });
      expect(stop).toBeDisabled();
      fireEvent.click(stop);
      const durable = (await getMessages(s.id)).find((message) => message.role === "assistant");
      const live = useSessionsStore.getState().messages.find((message) => message.role === "assistant");
      expect(durable?.status).toBe("done");
      expect(live?.status).toBe("done");
      release();
      await sessionOperationCoordinator.waitForIdle();
    });
  });

  it("يعرض تحذيرًا مرئيًا إذا فشل sidecar وتحذيره معًا", async () => {
    reposHook.failUsage = true;
    reposHook.failWarning = true;
    setTransportFetch((() => sseResponse(["done"])) as unknown as typeof fetch);
    const warning = vi.spyOn(toast, "warning");
    const s = await mkSession();
    seed(s, { targets: ONE });
    render(<ChatScreen session={s} />);
    await runToIdle(() => fireEvent.click(screen.getByRole("button", { name: /إرسال/ })));
    expect(warning).toHaveBeenCalledWith("تعذر حفظ حدث الاستهلاك");
    expect((await getMessages(s.id)).find((message) => message.role === "assistant")?.status).toBe("done");
    warning.mockRestore();
  });

  it("إعادة المحاولة تستبدل البطاقة الفاشلة بلا تكرار", async () => {
    const f = sseMockFetch();
    setTransportFetch(((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes("openrouter") ? new Response("{}", { status: 401 }) : f(input, init)) as typeof fetch);
    const s = await mkSession();
    seed(s, { targets: ONE });
    render(<ChatScreen session={s} />);
    await runToIdle(() => fireEvent.click(screen.getByRole("button", { name: /إرسال/ })));
    // مهلة أوسع من الافتراضية: تحت توازي عمال vitest قد يتأخر استقرار تدفق 401 عن ثانية
    await screen.findByText(/مفتاح غير صالح/, {}, { timeout: 3000 });
    // The terminal card is rendered before sidecars and the coordinator release finish.
    // Wait for the send affordance to return so this click tests a true retry, not a rejected concurrent start.
    await waitFor(() => expect(screen.getByRole("button", { name: /إرسال/ })).toBeInTheDocument(), { timeout: 3000 });
    setTransportFetch(sseMockFetch());
    await runToIdle(() => fireEvent.click(screen.getByLabelText("إعادة")));
    expect(await screen.findAllByText("أهلاً", {}, { timeout: 3000 })).toHaveLength(1);
    const finalRows = await getMessages(s.id);
    expect(finalRows.filter((m) => m.role === "assistant")).toHaveLength(1);
    const retried = finalRows.find((m) => m.role === "assistant");
    const record = retried ? await getTurn(retried.turnId) : undefined;
    expect(record?.attempts).toHaveLength(2);
    const latest = record?.attempts[record.attempts.length - 1];
    expect(latest?.kind).toBe("retry");
    expect(latest?.status).toBe("done");
    expect(retried?.attemptId).toBe(latest?.id);
    await settleOperations();
  });

  it("إيقاف Composer يحفظ النص الجزئي وحالة stopped في Dexie وواجهة الدردشة", async () => {
    let calls = 0;
    const chunk = (value: string) => new TextEncoder().encode("data: " + JSON.stringify({ choices: [{ delta: { content: value } }] }) + "\n\n");
    setTransportFetch((() => {
      calls += 1;
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(chunk("بداية")); },
      }), { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch);
    const s = await mkSession({ title: "composer-stop" });
    seed(s);
    render(<ChatScreen session={s} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /إرسال/ }));
      await vi.waitFor(() => expect(calls).toBe(2), { timeout: 3000 });
      await vi.waitFor(async () => {
        const rows = (await getMessages(s.id)).filter((message) => message.role === "assistant");
        expect(rows).toHaveLength(2);
        expect(rows.every((message) => message.text === "بداية" && message.status === "streaming")).toBe(true);
      }, { timeout: 3000 });
      const stops = screen.getAllByRole("button", { name: /إيقاف/ });
      fireEvent.click(stops[stops.length - 1]);
      await sessionOperationCoordinator.waitForIdle();
    });
    const rows = (await getMessages(s.id)).filter((message) => message.role === "assistant");
    expect(rows).toHaveLength(2);
    expect(rows.every((message) => message.text === "بداية" && message.status === "stopped")).toBe(true);
    expect(screen.getAllByText("أُوقف")).toHaveLength(2);
  }, 10000);

  it("يعرض تحذير الإلغاء للجلسة نفسها إذا لم تبدأ عملية بديلة", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let held!: () => void;
    const heldPromise = new Promise<void>((resolve) => { held = resolve; });
    reposHook.holdOnCall = 3;
    reposHook.holdGate = gate;
    reposHook.onHoldStart = held;
    reposHook.failFinal = true;
    setTransportFetch(sseMockFetch());
    const s = await mkSession({ title: "cancel-warning" });
    seed(s, { targets: ONE });
    const warningSpy = vi.spyOn(toast, "warning");
    render(<ChatScreen session={s} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /إرسال/ }));
      await vi.waitFor(() => {
        expect(reposHook.appendCalls).toBeGreaterThanOrEqual(3);
      }, { timeout: 3000 });
      await heldPromise;
      expect(sessionOperationCoordinator.activeFor(s.id)).toBeTruthy();
      sessionOperationCoordinator.cancel(s.id);
      release();
      await sessionOperationCoordinator.waitForIdle();
    });
    expect(warningSpy).toHaveBeenCalledWith(expect.stringContaining("تعذر تثبيت"));
    expect(sessionOperationCoordinator.activeOperationIds()).not.toContain(sessionOperationCoordinator.latestFor(s.id) ?? "missing");
  }, 10000);

  it("مع مُنشّط ملفات: أول إرسال يملأ onDiskDir ويكتب الجلسة على القرص", async () => {
    const sink = memoryFileSink();
    setFileSink(sink);
    const s = await mkSession();
    seed(s);
    render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByRole("button", { name: /إرسال/ }));
    expect(await screen.findAllByText("أهلاً", {}, { timeout: 3000 })).toHaveLength(2);
    const meta = await getSession(s.id);
    expect(meta?.onDiskDir).toBeTruthy();
    const dir = "sessions/" + meta?.onDiskDir;
    expect(await sink.exists(dir + "/meta.json")).toBe(true);
    // session.md تُكتب بعد استقرار النتائج مباشرة — ننتظرها بدل سباق مع حلقة النتائج
    await waitFor(async () => expect(await sink.exists(dir + "/session.md")).toBe(true), { timeout: 3000 });
    expect(await sink.readFile(dir + "/session.md")).toContain("أهلاً");
    await settleOperations();
  });

  it("الخلاصة تثبت صفها في Dexie عند الاكتمال: إعادة التحميل تعرض النص لا بثًا معلقًا", async () => {
    const s = await mkSession();
    seed(s);
    // تمرّة مكتملة حتى يمر حارس «لا نتائج لاستخلاصها بعد» ويُشتق النموذج الأساسي من targets[0]
    useSessionsStore.setState({ messages: doneTurn(s) });
    render(<ChatScreen session={s} />);
    await runToIdle(() => fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ })));
    expect(await screen.findByText("خلاصة النموذج الأساسي")).toBeInTheDocument();
    // إعادة التحميل من Dexie بعد الاكتمال: صف الخلاصة بنصه النهائي وحالته done (لا فارغ/streaming)
    await waitFor(async () => {
      const rows = await getMessages(s.id);
      const synth = rows.find((m) => m.kind === "synthesis");
      expect(synth?.text).toBe("أهلاً");
      expect(synth?.status).toBe("done");
    }, { timeout: 3000 });
    await act(async () => {
      useSessionsStore.setState({ messages: await getMessages(s.id) });
      await Promise.resolve();
    });
    const assistants = (await getMessages(s.id)).filter((m) => m.role === "assistant");
    const last = assistants[assistants.length - 1];
    expect(last.kind).toBe("synthesis");
    expect(last.text.length).toBeGreaterThan(0);
    expect(last.status).toBe("done");
    await waitFor(async () => {
      const synth = (await getMessages(s.id)).find((m) => m.kind === "synthesis");
      const usage = await getUsageEvents({ sessionId: s.id });
      expect(synth?.operationId).toBeTruthy();
      expect(usage.some((event) => event.turnId === synth?.turnId && event.operationId === synth?.operationId && event.attemptId === synth?.attemptId)).toBe(true);
    }, { timeout: 3000 });
    await settleOperations();
  });

  // تمريرة مصدر بمعرف هدف مطابق لأهداف المؤلف (بلا لاحقة seed): شرط عمل الإعادة فعليًا
  function seededTurn(s: SessionMeta): ChatMessage[] {
    const turnId = `tr-${s.id}`;
    return [
      { id: "p1-" + s.id, sessionId: s.id, turnId, createdAt: 1, role: "user", kind: "prompt", text: "س1", promptKind: "shared", status: "done" },
      { id: "r1-" + s.id, sessionId: s.id, turnId, createdAt: 2, role: "assistant", kind: "result", text: "أهلاً", providerId: "openrouter", modelId: "openai/gpt-4o", modelInfo: { id: "openai/gpt-4o", label: "GPT-4o" }, targetId: "t1_" + s.id, status: "done" },
    ];
  }

  it("يرفض نتيجة خلاصة بمعرّف عملية أو هدف غير مطابق ولا يحفظها كنجاح", async () => {
    const cases = [
      { operationId: "wrong-op", targetId: undefined as string | undefined },
      { operationId: undefined as string | undefined, targetId: "wrong-target" },
    ];
    for (const [index, forced] of cases.entries()) {
      const s = await mkSession();
      seed(s, { targets: ONE });
      useSessionsStore.setState({ messages: seededTurn(s) });
      summaryDispatchHook.forceOperationId = forced.operationId;
      summaryDispatchHook.forceTargetId = forced.targetId;
      render(<ChatScreen session={s} />);
      await runToIdle(() => fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ })));
      await waitFor(async () => {
        const synth = (await getMessages(s.id)).find((m) => m.kind === "synthesis");
        expect(synth?.status, "case=" + index).toBe("error");
      }, { timeout: 3000 });
      expect(await getUsageEvents({ sessionId: s.id })).toHaveLength(0);
      await settleOperations();
      cleanup();
      summaryDispatchHook.forceOperationId = undefined;
      summaryDispatchHook.forceTargetId = undefined;
    }
  });

  it("إعادة المحاولة تعمل بعد وجود خلاصة: تُعاد من تمريرة المصدر لا من syn- الأخيرة", async () => {
    const s = await mkSession();
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: seededTurn(s) });
    // بثّ متمايز: نداء الخلاصة يعيد «أهلاً» ونداء الإعادة يعيد «مُعاد» — الفرق يثبت أن الإعادة نُفذت
    let calls = 0;
    setTransportFetch(((...a: unknown[]) => { void a; calls += 1; return sseResponse(calls === 1 ? ["أهلاً"] : ["مُعاد"]); }) as unknown as typeof fetch);
    render(<ChatScreen session={s} />);
    await runToIdle(() => fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ })));
    expect(await screen.findByText("خلاصة النموذج الأساسي")).toBeInTheDocument();
    await waitFor(async () => { const synth = (await getMessages(s.id)).find((m) => m.kind === "synthesis"); expect(synth?.status, "synthErr=" + synth?.error).toBe("done"); }, { timeout: 3000 });
    // The synthesis card is terminal before its sidecars finish; wait for operation release before retrying.
    await waitFor(() => expect(screen.getByRole("button", { name: /إرسال/ })).toBeInTheDocument(), { timeout: 3000 });
    // الآن «إعادة» على بطاقة تمريرة المصدر — كانت صامتة (آخر تمريرة syn- بلا targetId)
    await runToIdle(() => fireEvent.click(screen.getByLabelText("إعادة")));
    expect(await screen.findByText("مُعاد", {}, { timeout: 3000 })).toBeInTheDocument();
    const retried = (await getMessages(s.id)).find((m) => m.text === "مُعاد");
    const record = retried ? await getTurn(retried.turnId) : undefined;
    // The message-only fixture is backfilled as a durable source before the retry attempt.
    expect(record?.attempts).toHaveLength(2);
    expect(record?.attempts[0]?.id).toMatch(/^legacy-/);
    expect(record?.attempts[0]?.targets[0]?.modelInfo?.id).toBe("openai/gpt-4o");
    const latest = record?.attempts[record.attempts.length - 1];
    expect(latest?.kind).toBe("retry");
    expect(latest?.status).toBe("done");
    expect(retried?.attemptId).toBe(latest?.id);
    await settleOperations();
  });

  it("يعيد المحاولة من لقطة الرسالة القديمة حتى مع تغيّر نموذج المؤلف", async () => {
    const s = await mkSession();
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: seededTurn(s) });
    useComposerStore.setState((state) => ({
      drafts: {
        ...state.drafts,
        [s.id]: {
          ...state.drafts[s.id]!,
          targets: state.drafts[s.id]!.targets.map((target) => ({
            ...target, providerId: "minimax", modelId: "changed-model", modelInfo: { id: "changed-model", label: "Changed" },
          })),
        },
      },
    }));
    let requestBody = "";
    setTransportFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = typeof init?.body === "string" ? init.body : await new Request(input, init).clone().text();
      return sseResponse(["legacy-retry"]);
    }) as unknown as typeof fetch);
    render(<ChatScreen session={s} />);
    await runToIdle(() => fireEvent.click(screen.getByLabelText("إعادة")));
    expect(await screen.findByText("legacy-retry", {}, { timeout: 3000 })).toBeInTheDocument();
    const record = await getTurn("tr-" + s.id);
    expect(record?.attempts[0]?.targets[0]?.modelId).toBe("openai/gpt-4o");
    expect(record?.attempts[1]?.targets[0]?.modelId).toBe("openai/gpt-4o");
    expect(requestBody).toContain("openai/gpt-4o");
    expect(requestBody).not.toContain("changed-model");
    expect(requestBody).toContain("س1");
    await settleOperations();
  });

  it("يدعم إعادة المحاولة legacy ذات مخصص فقط دون اعتماد على المسودة", async () => {
    const s = await mkSession();
    seed(s, { targets: ONE });
    const targetId = "t1_" + s.id;
    useSessionsStore.setState({ messages: [
      { id: "p-custom", sessionId: s.id, turnId: "tr-" + s.id, createdAt: 1, role: "user", kind: "prompt", text: "سؤال مخصص قديم", promptKind: "custom", targetId, status: "done" },
      { id: "r-custom", sessionId: s.id, turnId: "tr-" + s.id, createdAt: 2, role: "assistant", kind: "result", text: "قديم", targetId, providerId: "openrouter", modelId: "openai/gpt-4o", modelInfo: { id: "openai/gpt-4o", label: "GPT-4o" }, status: "error" },
    ] });
    setTransportFetch((() => sseResponse(["custom-retry"])) as unknown as typeof fetch);
    render(<ChatScreen session={s} />);
    await runToIdle(() => fireEvent.click(screen.getByLabelText("إعادة")));
    expect(await screen.findByText("custom-retry", {}, { timeout: 3000 })).toBeInTheDocument();
    const historicalCustomToggle = screen.getByRole("button", { name: /السؤال المخصص/ });
    fireEvent.click(historicalCustomToggle);
    expect(await screen.findByText("سؤال مخصص قديم", {}, { timeout: 3000 })).toBeInTheDocument();
    const record = await getTurn("tr-" + s.id);
    expect(record?.attempts[0]?.targets[0]?.customPrompt).toBe("سؤال مخصص قديم");
    await settleOperations();
  });

  it("إلغاء بعد تثبيت محاولة legacy لا يجعل التمريرة غير قابلة لإعادة المحاولة", async () => {
    const s = await mkSession();
    seed(s, { targets: ONE });
    const targetId = "t1_" + s.id;
    // A message-only legacy turn: no TurnRecord exists, so the retry must backfill one.
    useSessionsStore.setState({ messages: [
      { id: "p-legacy", sessionId: s.id, turnId: "tr-" + s.id, createdAt: 1, role: "user", kind: "prompt", text: "سؤال قديم محفوظ", promptKind: "shared", status: "done" },
      { id: "r-legacy", sessionId: s.id, turnId: "tr-" + s.id, createdAt: 2, role: "assistant", kind: "result", text: "قديم", targetId, providerId: "openrouter", modelId: "openai/gpt-4o", modelInfo: { id: "openai/gpt-4o", label: "GPT-4o" }, status: "error" },
    ] });
    // The composer draft must never be the retry source: the immutable snapshot is.
    useComposerStore.getState().setDraft(s.id, { sharedPrompt: "مسودة حيّة مختلفة" });
    setFileSink(memoryFileSink());
    setTransportFetch((() => sseResponse(["legacy-retry-ok"])) as unknown as typeof fetch);

    let releaseUpdate!: () => void;
    const updateGate = new Promise<void>((resolve) => { releaseUpdate = resolve; });
    let updateStarted!: () => void;
    const updateStart = new Promise<void>((resolve) => { updateStarted = resolve; });
    reposHook.holdSessionUpdate = true;
    reposHook.sessionUpdateGate = updateGate;
    reposHook.onSessionUpdateStart = updateStarted;
    render(<ChatScreen session={s} />);
    // First retry: backfill persists, then the operation is canceled before sendTurn.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("إعادة"));
      await updateStart;
      sessionOperationCoordinator.cancel(s.id);
      releaseUpdate();
      await sessionOperationCoordinator.waitForIdle();
    });
    await settleOperations();
    const afterBackfill = await getTurn("tr-" + s.id);
    expect(afterBackfill?.attempts.length, "the legacy backfill must be durable").toBe(1);

    // Second retry: the backfilled attempt is still discoverable, so the immutable
    // historical snapshot is retried instead of failing as an unidentified row.
    reposHook.holdSessionUpdate = false;
    await act(async () => {
      fireEvent.click(screen.getByLabelText("إعادة"));
      await sessionOperationCoordinator.waitForIdle();
    });
    expect(await screen.findByText("legacy-retry-ok", {}, { timeout: 3000 })).toBeInTheDocument();
    const final = await getTurn("tr-" + s.id);
    const retried = final?.attempts.find((a) => a.attempt === 2);
    expect(retried?.targets[0]?.sharedPrompt, "the retry must use the immutable legacy snapshot").toBe("سؤال قديم محفوظ");
    expect(final?.attempts[0]?.id).toBe("legacy-tr-" + s.id);
    await settleOperations();
  });

  it("لا يسقط إلى مسودة حية عند وجود TurnRecord بمحاولة غير مطابقة", async () => {
    const s = await mkSession();
    seed(s, { targets: ONE });
    const messages = seededTurn(s);
    useSessionsStore.setState({ messages });
    await putTurn({ id: "tr-" + s.id, sessionId: s.id, createdAt: 1, status: "error", contextMode: "stateful", sharedPrompt: "س1", attempts: [{
      id: "other-attempt", turnId: "tr-" + s.id, attempt: 1, kind: "retry", createdAt: 1, status: "error", operationId: "other-op", targets: [{ targetId: "t1_" + s.id, providerId: "openrouter", modelId: "openai/gpt-4o", modelInfo: { id: "openai/gpt-4o", label: "GPT-4o" }, sharedPrompt: "س1", customPrompt: null, promptText: "س1", hasShared: true, hasCustom: false }],
    }] });
    let calls = 0;
    setTransportFetch((() => { calls += 1; return sseResponse(["must-not-run"]); }) as unknown as typeof fetch);
    const errorSpy = vi.spyOn(toast, "error");
    render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByLabelText("إعادة"));
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(calls).toBe(0);
    await settleOperations();
  });

  it("ضغط مزدوج على الخلاصة لا يولد تمريرتي خلاصة", async () => {
    const s = await mkSession();
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: seededTurn(s) });
    render(<ChatScreen session={s} />);
    const btn = screen.getByRole("button", { name: /استخرج خلاصة/ });
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
      await sessionOperationCoordinator.waitForIdle();
    });
    expect(await screen.findByText("خلاصة النموذج الأساسي")).toBeInTheDocument();
    await waitFor(async () => expect((await getMessages(s.id)).find((m) => m.kind === "synthesis")?.status).toBe("done"), { timeout: 3000 });
    const rows = await getMessages(s.id);
    expect(rows.filter((m) => m.kind === "synthesis")).toHaveLength(1);
    expect(rows.filter((m) => m.role === "user" && m.text === "طلب خلاصة من النموذج الأساسي")).toHaveLength(1);
    await settleOperations();
  });

  it("خطأ داخلي أثناء الخلاصة: بطاقة خطأ لا بث معلق", async () => {
    const s = await mkSession();
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: seededTurn(s) });
    // الفشل يقتصر على صف الخلاصة النهائي، لا نقطة حفظ المؤقتة.
    reposHook.failFinalSummary = true;
    render(<ChatScreen session={s} />);
    await runToIdle(() => fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ })));
    expect(await screen.findByText("فشل تخزين داخلي", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText("يكتب…")).not.toBeInTheDocument();
    await waitFor(async () => expect((await getMessages(s.id)).find((m) => m.kind === "synthesis")?.status).toBe("error"), { timeout: 3000 });
    await settleOperations();
  });

  it("فشل حفظ الخلاصة بعد تبديل الجلسة يثبت الخطأ النهائي في الجلسة الأصلية بهويتي المحاولة والعملية", async () => {
    let release!: () => void;
    const holdGate = new Promise<void>((resolve) => { release = resolve; });
    let held!: () => void;
    const heldPromise = new Promise<void>((resolve) => { held = resolve; });
    reposHook.holdFinalSummary = true;
    reposHook.failFinalSummary = true;
    reposHook.holdGate = holdGate;
    reposHook.onHoldStart = held;
    setTransportFetch((() => sseResponse(["نص جزئي محفوظ"])) as unknown as typeof fetch);
    const s = await mkSession();
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: seededTurn(s) });
    render(<ChatScreen session={s} />);
    let synth: ChatMessage | undefined;
    let prompt: ChatMessage | undefined;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
      await heldPromise;
      const other = await mkSession();
      useSessionsStore.setState((state) => ({ sessions: [...state.sessions, other], currentId: other.id }));
      release();
      await sessionOperationCoordinator.waitForIdle();
      const rows = await getMessages(s.id);
      synth = rows.find((m) => m.kind === "synthesis");
      prompt = rows.find((m) => m.kind === "prompt" && m.text === "طلب خلاصة من النموذج الأساسي");
    });
    expect(synth?.status).toBe("error");
    expect(synth?.text).toBe("نص جزئي محفوظ");
    expect(synth?.error).toBe("فشل تخزين داخلي");
    expect(synth?.attemptId).toBe(prompt?.attemptId);
    expect(synth?.operationId).toBe(prompt?.operationId);
    expect(synth?.usage).toBeTruthy();
    expect(synth?.attemptId).toBeTruthy();
    expect(synth?.operationId).toBeTruthy();
  });

  it("تبديل الجلسة أثناء البث لا يقطع تجميع النص الأصلي ولا يفقد أرشيف خطأ الكتابة النهائية", async () => {
    const sink = memoryFileSink();
    setFileSink(sink);
    let release!: () => void;
    const releaseGate = new Promise<void>((resolve) => { release = resolve; });
    const chunk = (value: string) => new TextEncoder().encode("data: " + JSON.stringify({ choices: [{ delta: { content: value } }] }) + "\n\n");
    setTransportFetch((() => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(chunk("قبل"));
        void releaseGate.then(() => {
          controller.enqueue(chunk("بعد"));
          controller.close();
        });
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch);
    reposHook.failFinalSummary = true;
    const s = await mkSession();
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: doneTurn(s) });
    render(<ChatScreen session={s} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
      await vi.waitFor(() => {
        const synth = useSessionsStore.getState().messages.find((m) => m.kind === "synthesis");
        expect(synth?.text).toBe("قبل");
      }, { timeout: 3000 });
      const other = await mkSession();
      useSessionsStore.setState((state) => ({ sessions: [...state.sessions, other], currentId: other.id }));
      release();
      await sessionOperationCoordinator.waitForIdle();
    });
    const durableSynthesis = (await getMessages(s.id)).find((m) => m.kind === "synthesis");
    expect(durableSynthesis?.status).toBe("error");
    expect(durableSynthesis?.text).toBe("قبلبعد");
    await waitFor(async () => expect((await getSession(s.id))?.onDiskDir).toBeTruthy(), { timeout: 3000 });
    const dir = "sessions/" + (await getSession(s.id))?.onDiskDir;
    await waitFor(async () => expect(await sink.exists(dir + "/meta.json")).toBe(true), { timeout: 3000 });
    const sessionMd = await sink.readFile(dir + "/session.md");
    const resultFile = await sink.readFile(dir + "/turns/t01/01_synthesis__primary.md");
    const archived = JSON.parse(await sink.readFile(dir + "/meta.json"));
    const archivedResult = archived.turns[0].results[0];
    expect(sessionMd).toContain("قبلبعد");
    expect(resultFile).toContain("قبلبعد");
    expect(archived.turns[0].results[0].text).toBe("قبلبعد");
    expect(archived.turns[0].status[archivedResult.targetId]).toBe("error");
    expect(archived.turns[0].errors[archivedResult.targetId]).toBe("فشل تخزين داخلي");
    expect(sessionMd).toContain("⛔ فشل تخزين داخلي");
    expect(resultFile).toContain("⛔ فشل تخزين داخلي");
    await settleOperations();
  });

  it("الخلاصة الناجحة تُؤرشف على القرص: تمريرة synthesis في session.md وturns لا Dexie وحده", async () => {
    const sink = memoryFileSink();
    setFileSink(sink);
    const s = await mkSession();
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: seededTurn(s) });
    render(<ChatScreen session={s} />);
    await runToIdle(() => fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ })));
    expect(await screen.findByText("خلاصة النموذج الأساسي")).toBeInTheDocument();
    await waitFor(async () => expect((await getSession(s.id))?.onDiskDir).toBeTruthy(), { timeout: 3000 });
    const dir = "sessions/" + (await getSession(s.id))?.onDiskDir;
    await waitFor(async () => expect(await sink.exists(dir + "/session.md")).toBe(true), { timeout: 3000 });
    const md = await sink.readFile(dir + "/session.md");
    expect(md).toContain("## تمرّة 1");
    // أرشفة المحتوى لا الشاهد: نص الخلاصة الفعلي مقتبسًا ونتيجة بمدخل نصها (يعيد parser بناءها)
    expect(md).toContain("> أهلاً");
    expect(md).toContain("### خلاصة النموذج الأساسي (synthesis)");
    expect(md).toContain("أهلاً");
    const metaJson = JSON.parse(await sink.readFile(dir + "/meta.json"));
    expect(metaJson.turns).toHaveLength(1);
    expect(metaJson.turns[0].turn.id).toMatch(/^syn-/);
    const summaryAttempt = (await getTurn(metaJson.turns[0].turn.id))?.attempts[0];
    // Non-vacuous: a missing durable attempt must fail loudly instead of comparing
    // undefined on both sides.
    expect(summaryAttempt, "the archived summary must have a durable attempt record").toBeDefined();
    expect(summaryAttempt?.operationId).toEqual(expect.any(String));
    expect(metaJson.turns[0].operationId).toBe(summaryAttempt?.operationId);
    expect(metaJson.turns[0].attemptId).toBe(summaryAttempt?.id);
    expect(metaJson.turns[0].attemptId).toEqual(expect.any(String));
    expect(metaJson.turns[0].turn.sharedPrompt).toBe("أهلاً");
    expect(metaJson.turns[0].prompts).toEqual([]);
    const result0 = metaJson.turns[0].results[0];
    expect(result0.text).toBe("أهلاً");
    expect(typeof result0.targetId).toBe("string");
    expect(result0.usage).toBeTruthy();
    expect(metaJson.turns[0].status[result0.targetId]).toBe("done");
    await settleOperations();
  });

  it.each([
    { status: "error" as const, error: "خطأ الأرشفة التجريبي" },
    { status: "stopped" as const, error: undefined },
  ])("نتيجة الخلاصة $status تُؤرشف بنصها وحالتها وخطئها الدقيق", async ({ status, error }) => {
    const sink = memoryFileSink();
    setFileSink(sink);
    summaryDispatchHook.forceStatus = status;
    summaryDispatchHook.forceError = error;
    setTransportFetch((() => sseResponse(["نص الأرشفة الدقيق"])) as unknown as typeof fetch);
    const s = await mkSession();
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: seededTurn(s) });
    render(<ChatScreen session={s} />);
    await runToIdle(() => fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ })));
    await waitFor(async () => {
      const synth = (await getMessages(s.id)).find((m) => m.kind === "synthesis");
      expect(synth?.status).toBe(status);
    }, { timeout: 3000 });
    await waitFor(async () => expect((await getSession(s.id))?.onDiskDir).toBeTruthy(), { timeout: 3000 });
    const dir = "sessions/" + (await getSession(s.id))?.onDiskDir;
    await waitFor(async () => expect(await sink.exists(dir + "/meta.json")).toBe(true), { timeout: 3000 });
    const sessionMd = await sink.readFile(dir + "/session.md");
    const resultFile = await sink.readFile(dir + "/turns/t01/01_synthesis__primary.md");
    const metaJson = JSON.parse(await sink.readFile(dir + "/meta.json"));
    const archived = metaJson.turns[0];
    expect(sessionMd).toContain("نص الأرشفة الدقيق");
    expect(resultFile).toContain("نص الأرشفة الدقيق");
    expect(archived.results[0].text).toBe("نص الأرشفة الدقيق");
    expect(archived.status[archived.results[0].targetId]).toBe(status);
    expect(archived.errors[archived.results[0].targetId]).toBe(error);
    if (error) {
      expect(sessionMd).toContain("⛔ " + error);
      expect(resultFile).toContain("⛔ " + error);
    }
    await settleOperations();
  });

  it("فشل صف التحذير بعد إعادة تركيب نفس الجلسة يظل التوست ظاهرًا", async () => {
    const base = memoryFileSink();
    // The archive write blocks until the test has remounted the same session, then
    // fails: the warning must survive a view remount that drops live ownership.
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    let writeStarted!: () => void;
    const writeStart = new Promise<void>((resolve) => { writeStarted = resolve; });
    const failingSink: FileSink = {
      ...base,
      writeFile: async () => { writeStarted(); await writeGate; throw new Error("قرص ممتلئ"); },
    };
    setFileSink(failingSink);
    reposHook.failWarning = true;
    setTransportFetch((() => sseResponse(["أهلاً"])) as unknown as typeof fetch);
    const s = await mkSession();
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: seededTurn(s) });
    const warnSpy = vi.spyOn(toast, "warning");
    const view = render(<ChatScreen key="first" session={s} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
      await writeStart;
    });
    // A same-session remount invalidates the captured view generation, so the live
    // owner predicate is false while the operation itself is still the latest one.
    view.rerender(<ChatScreen key="second" session={s} />);
    releaseWrite();
    await waitFor(() => expect(warnSpy).toHaveBeenCalledWith("حُفظت الخلاصة محليًا وفشل أرشفتها على القرص"), { timeout: 3000 });
    const synth = (await getMessages(s.id)).find((m) => m.kind === "synthesis");
    expect(synth?.status).toBe("done");
    expect(synth?.text).toBe("أهلاً");
    await settleOperations();
    warnSpy.mockRestore();
  });

  it("فشل الأرشفة لا يمس صف الخلاصة في Dexie: النص سليم وstatus done مع توست تحذيري", async () => {
    const base = memoryFileSink();
    // سينك يرمي عند أول كتابة: appendTurn يفشل بعد اكتمال البث والثبات الناجح
    const failingSink: FileSink = { ...base, writeFile: async () => { throw new Error("قرص ممتلئ"); } };
    setFileSink(failingSink);
    const s = await mkSession();
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: seededTurn(s) });
    const warnSpy = vi.spyOn(toast, "warning");
    render(<ChatScreen session={s} />);
    await runToIdle(() => fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ })));
    await waitFor(async () => { const synth = (await getMessages(s.id)).find((m) => m.kind === "synthesis"); expect(synth?.status, "synthErr=" + synth?.error).toBe("done"); }, { timeout: 4000 });
    // انتظار اكتمال سلسلة الأرشفة (فشلها وتوستها) — قد تحسم بعد ثبات صف Dexie بقليل
    await waitFor(() => expect(warnSpy).toHaveBeenCalledWith("حُفظت الخلاصة محليًا وفشل أرشفتها على القرص"), { timeout: 3000 });
    const synth = (await getMessages(s.id)).find((m) => m.kind === "synthesis");
    expect(synth?.text).toBe("أهلاً");
    await settleOperations();
    warnSpy.mockRestore();
  });
});

describe("المهمة 4 — المقياس الحقيقي، ووضع السياق، وتوصيل الهوية", () => {
  it("المقياس يستخدم حد التركيز (الاحتياط: أولًا) والحديث لا نسبة مولّدة من السجل", async () => {
    const s = await mkSession();
    useSessionsStore.setState({ sessions: [s], currentId: s.id, messages: [{ id: "m1", sessionId: s.id, turnId: `tr-${s.id}`, createdAt: 1, role: "user", kind: "prompt", text: "x".repeat(3999), promptKind: "shared", status: "done" }] });
    useSettingsStore.setState({ providerKeys: { openrouter: "k", minimax: "k" }, timeoutMs: 5000 });
    const t1 = { targetId: "t1_" + s.id, providerId: "openrouter" as const, modelId: "openai/gpt-4o", modelInfo: { id: "openai/gpt-4o", label: "GPT-4o" } };
    const t2 = { targetId: "t2_" + s.id, providerId: "minimax" as const, modelId: "MiniMax-M2", modelInfo: { id: "MiniMax-M2", label: "MiniMax M2", contextLength: 2000 } };
    useComposerStore.setState({ drafts: { [s.id]: { targets: [t1, t2], syncMode: true, sharedPrompt: "س1", customs: {}, focusTargetId: null } } });
    render(<ChatScreen session={s} />);
    // بلا تركيز: الاحتياط هو الهدف الأول (بلا contextLength) → علامة الجهل «؟» لا 128000 المولّدة (0%/1%)
    expect(screen.getByText("؟")).toBeInTheDocument();
    expect(screen.queryByText("1%")).toBeNull();
    expect(screen.queryByText("0%")).toBeNull();
    // تركيز الهدف الثاني: 1000 رمز تقديرية من 2000 → 50%
    fireEvent.click(screen.getAllByText(/MiniMax-M2/)[0]);
    expect(await screen.findByText("50%")).toBeInTheDocument();
    expect(screen.queryByText("؟")).toBeNull();
  });

  it("تبديل بلا حالة يُثبت صريحًا (updateSession + الحالة الحية) وتظهر شارة المقارنة في الوضع فقط", async () => {
    const s = await mkSession();
    seed(s);
    render(<ChatScreen session={s} />);
    const sw = screen.getByRole("switch", { name: "وضع السياق" });
    expect(sw).not.toBeChecked();
    expect(screen.queryByText("مقارنة stateless")).toBeNull();
    fireEvent.click(sw);
    expect(await screen.findByText("مقارنة stateless")).toBeInTheDocument();
    await waitFor(async () => expect((await getSession(s.id))?.contextMode).toBe("stateless"));
    expect(useSessionsStore.getState().sessions.find((x) => x.id === s.id)?.contextMode).toBe("stateless");
    // العودة إلى stateful أيضًا تُثبت صريحًا في Dexie —لا وضع ضمني
    fireEvent.click(sw);
    await waitFor(async () => expect((await getSession(s.id))?.contextMode).toBe("stateful"));
    expect(useSessionsStore.getState().sessions.find((x) => x.id === s.id)?.contextMode).toBe("stateful");
    expect(screen.queryByText("مقارنة stateless")).toBeNull();
  });

  it("جلسة محفوظة stateless تعرض الشارة فور فتحها (الوضع ليس ضمنيًا)", async () => {
    const s = await mkSession({ contextMode: "stateless" });
    seed(s);
    render(<ChatScreen session={s} />);
    expect(screen.getByText("مقارنة stateless")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "وضع السياق" })).toBeChecked();
  });
});

describe("المهمة 5 — الخلاصة بالحالة الصريحة والنص الجزئي", () => {
  it("استثناء تحديث واجهة البث لا يقطع تجميع الخلاصة ونقطة حفظها", async () => {
    const upsertSpy = vi.spyOn(useSessionsStore.getState(), "upsertMessagesLocal").mockImplementation(() => {
      throw new Error("فشل تحديث واجهة البث");
    });
    setTransportFetch((() => sseResponse(["x".repeat(600)])) as unknown as typeof fetch);
    const s = await mkSession({ title: "patchthrow" });
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: doneTurn(s) });
    render(<ChatScreen session={s} />);
    await runToIdle(() => fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ })));
    await waitFor(async () => {
      const synth = (await getMessages(s.id)).find((m) => m.kind === "synthesis");
      expect(synth?.status).toBe("done");
      expect(synth?.text).toBe("x".repeat(600));
    }, { timeout: 3000 });
    expect(upsertSpy).toHaveBeenCalled();
    expect(reposHook.streamingCalls).toBeGreaterThanOrEqual(2);
    await settleOperations();
  });

  it("يحفظ سياق الجلسة الملتقطة إذا تبدلت الجلسة قبل بدء نداء الخلاصة", async () => {
    let release!: () => void;
    const holdGate = new Promise<void>((resolve) => { release = resolve; });
    let held!: () => void;
    const heldPromise = new Promise<void>((resolve) => { held = resolve; });
    reposHook.holdOnCall = 1;
    reposHook.holdGate = holdGate;
    reposHook.onHoldStart = held;
    let requestBody = "";
    setTransportFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = typeof init?.body === "string" ? init.body : await new Request(input, init).clone().text();
      return sseResponse(["خلاصة"]);
    }) as unknown as typeof fetch);
    const s = await mkSession({ title: "history-switch" });
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: doneTurn(s) });
    render(<ChatScreen session={s} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
      await heldPromise;
      const other = await mkSession({ title: "history-other" });
      useSessionsStore.setState((state) => ({ sessions: [...state.sessions, other], currentId: other.id, messages: [] }));
      release();
      await sessionOperationCoordinator.waitForIdle();
    });
    const synth = (await getMessages(s.id)).find((m) => m.kind === "synthesis");
    expect(synth?.status).toBe("done");
    expect(requestBody).toContain("جواب");
  });

  it("لا يلمس عرض الجلسة المفتوحة من جديد عملية خلاصة قديمة بعد A ثم B ثم A", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    const chunk = (value: string) => new TextEncoder().encode("data: " + JSON.stringify({ choices: [{ delta: { content: value } }] }) + "\n\n");
    setTransportFetch((() => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(chunk("قبل"));
        entered();
        void gate.then(() => { controller.enqueue(chunk("بعد")); controller.close(); });
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch);
    const s = await mkSession({ title: "reopen-a" });
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: doneTurn(s) });
    const patchSpy = vi.spyOn(useSessionsStore.getState(), "patchMessage");
    const first = render(<ChatScreen session={s} />);
    let patchesBeforeReturn = 0;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
      await enteredPromise;
      patchesBeforeReturn = patchSpy.mock.calls.length;
      first.unmount();
      const other = await mkSession({ title: "reopen-b" });
      useSessionsStore.setState({ currentId: other.id, messages: [] });
      useSessionsStore.setState({ currentId: s.id, messages: doneTurn(s) });
      render(<ChatScreen session={s} />);
      release();
      await sessionOperationCoordinator.waitForIdle();
    });
    const synth = (await getMessages(s.id)).find((m) => m.kind === "synthesis");
    expect(synth?.status).toBe("done");
    expect(patchSpy.mock.calls.length).toBe(patchesBeforeReturn);
    // إعادة فتح A تلتقط لقطة المنسّق الحالية؛ هذا ليس_patch مباشر من الإغلاق القديم.
    const reopenedSynthesis = useSessionsStore.getState().messages.filter((m) => m.kind === "synthesis");
    expect(reopenedSynthesis).toHaveLength(1);
    expect(reopenedSynthesis[0]).toMatchObject({ sessionId: s.id, status: "done", operationId: expect.any(String), attemptId: expect.any(String) });
    await settleOperations();
  });

  it("لا تستعيد عملية الخلاصة الملغاة حقها الحي بعد انتهاء عملية بديلة", async () => {
    let release!: () => void;
    const holdGate = new Promise<void>((resolve) => { release = resolve; });
    let held!: () => void;
    const heldPromise = new Promise<void>((resolve) => { held = resolve; });
    reposHook.holdOnCall = 1;
    reposHook.holdGate = holdGate;
    reposHook.onHoldStart = held;
    const s = await mkSession();
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: doneTurn(s) });
    const toastError = vi.spyOn(toast, "error");
    const toastWarning = vi.spyOn(toast, "warning");
    render(<ChatScreen session={s} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
      await heldPromise;
      const old = sessionOperationCoordinator.activeFor(s.id);
      expect(old).toBeTruthy();
      sessionOperationCoordinator.cancel(s.id);
      const replacement = sessionOperationCoordinator.start(s.id, "send", new AbortController());
      expect(replacement).toBeTruthy();
      if (replacement) sessionOperationCoordinator.finish(replacement.id);
      release();
      await sessionOperationCoordinator.waitForIdle();
    });
    expect(useSessionsStore.getState().messages.some((message) => message.turnId.startsWith("syn-"))).toBe(false);
    expect(toastError).not.toHaveBeenCalled();
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it("placeholder الخلاصة القديمة لا يُنشر بعد A ثم B ثم عودة A", async () => {
    let release!: () => void;
    const holdGate = new Promise<void>((resolve) => { release = resolve; });
    let held!: () => void;
    const heldPromise = new Promise<void>((resolve) => { held = resolve; });
    reposHook.holdOnCall = 2;
    reposHook.holdGate = holdGate;
    reposHook.onHoldStart = held;
    const sink = memoryFileSink();
    setFileSink(sink);
    let transportCalls = 0;
    setTransportFetch((() => {
      transportCalls += 1;
      return sseResponse(["B"]);
    }) as unknown as typeof fetch);
    const s = await mkSession({ title: "summary-placeholder-replacement" });
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: doneTurn(s) });
    const warning = vi.spyOn(toast, "warning");
    const error = vi.spyOn(toast, "error");
    render(<ChatScreen session={s} />);
    let oldOperationId = "";
    let bSessionDir: string | undefined;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
      await heldPromise;
      oldOperationId = sessionOperationCoordinator.activeFor(s.id)?.id ?? "";
      sessionOperationCoordinator.cancel(s.id);
      await waitFor(() => expect(screen.getByRole("button", { name: /إرسال/ })).not.toBeDisabled());
      fireEvent.click(screen.getByRole("button", { name: /إرسال/ }));
      await vi.waitFor(async () => {
        const rows = await getMessages(s.id);
        expect(rows.some((message) => message.kind === "result" && message.text === "B" && message.status === "done" && message.operationId !== oldOperationId)).toBe(true);
      }, { timeout: 3000 });
      await vi.waitFor(() => expect(sessionOperationCoordinator.activeFor(s.id)).toBeNull(), { timeout: 3000 });
      bSessionDir = (await getSession(s.id))?.onDiskDir;
      release();
      await sessionOperationCoordinator.waitForIdle();
    });
    expect(oldOperationId).toBeTruthy();
    expect(transportCalls).toBe(1);
    expect((await getMessages(s.id)).some((message) => message.kind === "synthesis" && message.operationId === oldOperationId)).toBe(false);
    expect(useSessionsStore.getState().messages.some((message) => message.kind === "synthesis" && message.operationId === oldOperationId)).toBe(false);
    expect(bSessionDir).toBeTruthy();
    expect((await getSession(s.id))?.onDiskDir).toBe(bSessionDir);
    expect(warning).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("يصرّف نقاط حفظ الخلاصة المسجلة قبل الإغلاق قبل الصف النهائي", async () => {
    let release!: () => void;
    const holdGate = new Promise<void>((resolve) => { release = resolve; });
    let held!: () => void;
    const heldPromise = new Promise<void>((resolve) => { held = resolve; });
    reposHook.holdOnCall = 3;
    reposHook.holdGate = holdGate;
    reposHook.onHoldStart = held;
    summaryDispatchHook.forceStatus = "stopped";
    setTransportFetch((() => sseResponse(["بداية", "x".repeat(600), "y".repeat(600)])) as unknown as typeof fetch);
    const s = await mkSession();
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: doneTurn(s) });
    render(<ChatScreen session={s} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
      await heldPromise;
      await vi.waitFor(() => {
        const synth = useSessionsStore.getState().messages.find((m) => m.kind === "synthesis");
        expect(synth?.text).toBe("بداية" + "x".repeat(600) + "y".repeat(600));
      }, { timeout: 3000 });
      // Yield one event-loop turn so ChatScreen enters settleStream before the first checkpoint is released.
      await new Promise((resolve) => setTimeout(resolve, 0));
      release();
      await sessionOperationCoordinator.waitForIdle();
    });
    const synth = (await getMessages(s.id)).find((m) => m.kind === "synthesis");
    expect(synth?.status).toBe("stopped");
    expect(synth?.text).toBe("بداية" + "x".repeat(600) + "y".repeat(600));
    expect(reposHook.appendCalls).toBe(6);
    expect(reposHook.streamingCalls).toBe(4);
  });

  it("إلغاء أثناء حفظ placeholder الخلاصة لا يصل إلى الإرسال", async () => {
    let release!: () => void;
    const holdGate = new Promise<void>((resolve) => { release = resolve; });
    let held!: () => void;
    const heldPromise = new Promise<void>((resolve) => { held = resolve; });
    reposHook.holdOnCall = 2;
    reposHook.holdGate = holdGate;
    reposHook.onHoldStart = held;
    let transportCalls = 0;
    setTransportFetch((() => {
      transportCalls += 1;
      return sseResponse(["must-not-run"]);
    }) as unknown as typeof fetch);
    const s = await mkSession();
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: doneTurn(s) });
    render(<ChatScreen session={s} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
      await heldPromise;
      sessionOperationCoordinator.cancel(s.id);
      release();
      await sessionOperationCoordinator.waitForIdle();
    });
    expect(transportCalls).toBe(0);
    expect((await getMessages(s.id)).find((message) => message.kind === "synthesis")?.status).toBe("stopped");
  });

  it("يصل إلى حالة طرفية صريحة عند فشل نتيجة الخلاصة وتحديث المحاولة معًا", async () => {
    reposHook.failFinalSummary = true;
    summaryAttemptHook.failCount = 1;
    setTransportFetch((() => sseResponse(["نتيجة"])) as unknown as typeof fetch);
    const s = await mkSession();
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: doneTurn(s) });
    render(<ChatScreen session={s} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
      await sessionOperationCoordinator.waitForIdle();
    });
    const synth = (await getMessages(s.id)).find((message) => message.kind === "synthesis");
    const turn = await getTurn("syn-" + s.id + "-tr-" + s.id);
    expect(synth).toMatchObject({ status: "error", error: "فشل تخزين داخلي" });
    expect(turn?.attempts[0]?.status).toBe("error");
  });

  it("إلغاء في نافذة ما بعد البث وقبل الصف النهائي لا ينشر done", async () => {
    let release!: () => void;
    const holdGate = new Promise<void>((resolve) => { release = resolve; });
    let held!: () => void;
    const heldPromise = new Promise<void>((resolve) => { held = resolve; });
    let resolved!: () => void;
    const resolvedPromise = new Promise<void>((resolve) => { resolved = resolve; });
    // Park the first streaming checkpoint so settleStream() blocks. Once dispatch has
    // resolved, cancelling here is exactly the post-dispatch/pre-final window: the
    // final append must never start, and success-only sidecars must stay gated.
    reposHook.holdOnCall = 3;
    reposHook.holdGate = holdGate;
    reposHook.onHoldStart = held;
    summaryDispatchHook.onResolved = resolved;
    setTransportFetch((() => sseResponse(["ا".repeat(600), "ب".repeat(600)])) as unknown as typeof fetch);
    const s = await mkSession();
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: doneTurn(s) });
    render(<ChatScreen session={s} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
      await heldPromise;
      await resolvedPromise;
      sessionOperationCoordinator.cancel(s.id);
      release();
      await sessionOperationCoordinator.waitForIdle();
    });
    const synth = (await getMessages(s.id)).find((message) => message.kind === "synthesis");
    const turn = await getTurn("syn-" + s.id + "-tr-" + s.id);
    expect(synth?.status, "the late final append must not publish done").toBe("stopped");
    expect(turn?.attempts[0]?.status).toBe("stopped");
    expect(await getUsageEvents({ sessionId: s.id })).toEqual([]);
  });

  it("إلغاء بعد انتهاء البث وقبل الصف النهائي يوقف الخلاصة ولا يقرّض event نجاح", async () => {
    let release!: () => void;
    const holdGate = new Promise<void>((resolve) => { release = resolve; });
    let held!: () => void;
    const heldPromise = new Promise<void>((resolve) => { held = resolve; });
    // Park the first non-streaming synthesis append (the final row). Dispatch has already
    // resolved at that point, so cancelling before releasing the gate is exactly the
    // post-dispatch/pre-final window: the late "done" write must not win.
    reposHook.holdFinalSummary = true;
    reposHook.holdGate = holdGate;
    reposHook.onHoldStart = held;
    setTransportFetch((() => sseResponse(["خلاصة مكتملة"])) as unknown as typeof fetch);
    const s = await mkSession();
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: doneTurn(s) });
    render(<ChatScreen session={s} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
      await heldPromise;
      sessionOperationCoordinator.cancel(s.id);
      release();
      await sessionOperationCoordinator.waitForIdle();
    });
    const synth = (await getMessages(s.id)).find((message) => message.kind === "synthesis");
    const turn = await getTurn("syn-" + s.id + "-tr-" + s.id);
    expect(synth?.status, "a cancel that lands after dispatch must not publish done").toBe("stopped");
    expect(synth?.text).toBe("خلاصة مكتملة");
    expect(turn?.attempts[0]?.status).toBe("stopped");
    // Success-only sidecars must stay gated: no usage event for a canceled summary.
    expect(await getUsageEvents({ sessionId: s.id })).toEqual([]);
  });

  it("لا يصرّف نقطة حفظ خلاصة موضوعة في الطابور بعد الإلغاء", async () => {
    let release!: () => void;
    const holdGate = new Promise<void>((resolve) => { release = resolve; });
    let held!: () => void;
    const heldPromise = new Promise<void>((resolve) => { held = resolve; });
    reposHook.holdOnCall = 3;
    reposHook.holdGate = holdGate;
    reposHook.onHoldStart = held;
    setTransportFetch((() => sseResponse(["بداية", "x".repeat(600), "y".repeat(600)])) as unknown as typeof fetch);
    const s = await mkSession();
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: doneTurn(s) });
    render(<ChatScreen session={s} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
      await heldPromise;
      sessionOperationCoordinator.cancel(s.id);
      release();
      await sessionOperationCoordinator.waitForIdle();
    });
    const synth = (await getMessages(s.id)).find((message) => message.kind === "synthesis");
    expect(reposHook.streamingCalls).toBe(2);
    expect(synth?.status).toBe("stopped");
  });

  it("تبديل الجلسة أثناء انتظار الصف النهائي لا يعرض خطأ الخلاصة القديمة", async () => {
    const sink = memoryFileSink();
    setFileSink(sink);
    let release!: () => void;
    const holdGate = new Promise<void>((resolve) => { release = resolve; });
    let held!: () => void;
    const heldPromise = new Promise<void>((resolve) => { held = resolve; });
    reposHook.holdFinalSummary = true;
    reposHook.holdGate = holdGate;
    reposHook.onHoldStart = held;
    summaryDispatchHook.forceStatus = "error";
    summaryDispatchHook.forceError = "خطأ النتيجة القديمة";
    setTransportFetch((() => sseResponse(["نتيجة"])) as unknown as typeof fetch);
    const s = await mkSession({ onDiskDir: "toast-race-error" });
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: doneTurn(s) });
    const errSpy = vi.spyOn(toast, "error");
    render(<ChatScreen session={s} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
      await heldPromise;
      const other = await mkSession();
      useSessionsStore.setState((state) => ({ sessions: [...state.sessions, other], currentId: other.id }));
      release();
      await sessionOperationCoordinator.waitForIdle();
    });
    const dir = "sessions/" + s.onDiskDir;
    expect(await sink.exists(dir + "/meta.json")).toBe(true);
    expect(errSpy).not.toHaveBeenCalledWith("خطأ النتيجة القديمة");
  });

  it("تبديل الجلسة أثناء فشل الأرشفة لا يعرض تحذير الخلاصة القديمة", async () => {
    const base = memoryFileSink();
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void;
    const archiveGate = new Promise<void>((resolve) => { release = resolve; });
    const failingSink: FileSink = { ...base, writeFile: async (path, content) => {
      if (path.endsWith("/session.md")) {
        entered();
        await archiveGate;
        throw new Error("قرص ممتلئ أثناء الأرشفة");
      }
      return base.writeFile(path, content);
    } };
    setFileSink(failingSink);
    const s = await mkSession({ onDiskDir: "toast-race-warning" });
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: doneTurn(s) });
    const warnSpy = vi.spyOn(toast, "warning");
    render(<ChatScreen session={s} />);
    let synth: ChatMessage | undefined;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
      await enteredPromise;
      const other = await mkSession();
      useSessionsStore.setState((state) => ({ sessions: [...state.sessions, other], currentId: other.id }));
      release();
      await sessionOperationCoordinator.waitForIdle();
      synth = (await getMessages(s.id)).find((m) => m.kind === "synthesis");
    });
    expect(synth?.sidecarWarning).toBeTruthy();
    expect(warnSpy).not.toHaveBeenCalledWith("حُفظت الخلاصة محليًا وفشل أرشفتها على القرص");
  });

  it("الخلاصة تنقطع وسط البث: يحفظ النص الجزئي بحالة خطأ لا صف فارغ ولا بث معلق", async () => {
    const line = "data: " + JSON.stringify({ choices: [{ delta: { content: "بداية" } }] }) + "\n\n";
    const f = (async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(line)); setTimeout(() => c.error(new Error("انقطع الاتصال بالبث")), 40); } }), { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
    setTransportFetch(f);
    const s = await mkSession();
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: doneTurn(s) });
    render(<ChatScreen session={s} />);
    await runToIdle(() => fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ })));
    await waitFor(async () => {
      const rows = await getMessages(s.id);
      const synth = rows.find((m) => m.kind === "synthesis");
      expect(synth?.status).toBe("error");
      expect(synth?.text).toBe("بداية");
      expect(synth?.attemptId).toBeTruthy();
      expect(synth?.operationId).toBeTruthy();
    }, { timeout: 3000 });
    await settleOperations();
  }, 10000);

  it("إيقاف الخلاصة يلغي العملية ويضبط الصف النهائي على stopped", async () => {
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    setTransportFetch((() => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify({ choices: [{ delta: { content: "بداية" } }] }) + "\n\n"));
        entered();
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch);
    const s = await mkSession({ title: "summary-stop" });
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: doneTurn(s) });
    render(<ChatScreen session={s} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
      await enteredPromise;
      await vi.waitFor(async () => {
        const synth = (await getMessages(s.id)).find((message) => message.kind === "synthesis");
        expect(synth?.text).toBe("بداية");
      }, { timeout: 3000 });
      fireEvent.click(screen.getByRole("button", { name: /إيقاف/ }));
      await sessionOperationCoordinator.waitForIdle();
    });
    const synth = (await getMessages(s.id)).find((message) => message.kind === "synthesis");
    expect(synth?.status).toBe("stopped");
    expect(synth?.text).toBe("بداية");
    expect(synth?.attemptId).toBeTruthy();
    expect(synth?.operationId).toBeTruthy();
  }, 10000);
});