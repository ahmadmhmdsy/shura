import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendTurn, type SendArgs, type SendCallbacks } from "./chatController";
import type { DispatchOutcome, DispatchArgs } from "./dispatch";
import { getFileSink, isFilePersistActive, memoryFileSink, setFileSink, type FileSink } from "@/lib/markdown/sink";
import { setTransportFetch } from "@/lib/transport/transport";
import { sseMockFetch, sseResponse } from "@/test/mocks/sse";
import { createSession, getMessages, getSession, getTurn, getUsageEvents, reconcileInterruptedTurns } from "@/lib/db/repos";
import { db } from "@/lib/db/db";
import type { ChatMessage, SessionMeta } from "@/types";

// [المهمة 5] خطاف عزل الثراث الجانبية: جعل recordUsage يفشل يثبت أن الصف الأساسي لا يُمحى
const usageHook = vi.hoisted(() => ({ failUsage: false, calls: 0 }));
// [المهمة 5] خطاف رفض النداء: dispatchTurn يرمي دومًا فيثبت التنظيف وصف الخطأ النهائي
const dispatchHook = vi.hoisted(() => ({
  reject: false,
  rejectAfterDispatch: false,
  lateUpdateTarget: null as string | null,
  lateUpdateChunk: "",
  lateUpdateFired: false,
  calls: 0,
  overrideOutcomes: false,
  outcomes: null as DispatchOutcome[] | null,
  lastArgs: null as DispatchArgs | null,
}));
const persistenceHook = vi.hoisted(() => ({
  holdLookup: false,
  lookupGate: null as Promise<void> | null,
  onLookupStart: null as (() => void) | null,
  holdAttempt: false,
  holdAttemptTurnId: "",
  holdAttemptOperationId: "",
  attemptGate: null as Promise<void> | null,
  onAttemptStart: null as (() => void) | null,
}));
const appendHook = vi.hoisted(() => ({
  streamingCalls: 0,
  holdAt: 0,
  holdTarget: "",
  holdGate: null as Promise<void> | null,
  onHoldStart: null as (() => void) | null,
  onCheckpoint: null as (() => void) | null,
  failFinal: false,
  failFinalOnce: false,
  holdFinal: false,
  holdFinalGate: null as Promise<void> | null,
  onFinalHoldStart: null as (() => void) | null,
  failFinalCount: 0,
  failWarning: false,
  failPromptCount: 0,
  failPlaceholderCount: 0,
}));
const attemptHook = vi.hoisted(() => ({ failCount: 0, calls: 0 }));
vi.mock("@/lib/db/repos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/repos")>();
  return {
    ...actual,
    getTurn: async (turnId: string) => {
      if (persistenceHook.holdLookup && persistenceHook.lookupGate) {
        persistenceHook.onLookupStart?.();
        await persistenceHook.lookupGate;
      }
      return actual.getTurn(turnId);
    },
    persistTurnAttempt: async (...args: Parameters<typeof actual.persistTurnAttempt>) => {
      if (persistenceHook.holdAttempt && persistenceHook.attemptGate && (!persistenceHook.holdAttemptTurnId || args[1] === persistenceHook.holdAttemptTurnId) && (!persistenceHook.holdAttemptOperationId || args[2]?.operationId === persistenceHook.holdAttemptOperationId)) {
        persistenceHook.onAttemptStart?.();
        await persistenceHook.attemptGate;
      }
      return actual.persistTurnAttempt(...args);
    },
    recordUsage: async (ev: Parameters<typeof actual.recordUsage>[0]) => {
      usageHook.calls += 1;
      if (usageHook.failUsage) throw new Error("فشل حفظ الاستهلاك");
      return actual.recordUsage(ev);
    },
    updateTurnAttemptStatus: async (...args: Parameters<typeof actual.updateTurnAttemptStatus>) => {
      attemptHook.calls += 1;
      if (attemptHook.failCount > 0) {
        attemptHook.failCount -= 1;
        throw new Error("فشل تحديث المحاولة");
      }
      return actual.updateTurnAttemptStatus(...args);
    },
    appendMessage: async (msg: Parameters<typeof actual.appendMessage>[0]) => {
      if (msg.status === "streaming") {
        appendHook.streamingCalls += 1;
        const holdByCall = appendHook.holdAt > 0 && appendHook.streamingCalls === appendHook.holdAt;
        const holdByTarget = appendHook.holdTarget !== "" && msg.targetId === appendHook.holdTarget && msg.text.length > 0;
        if (appendHook.holdGate && (holdByCall || holdByTarget)) {
          appendHook.onHoldStart?.();
          await appendHook.holdGate;
        }
      }
      if (appendHook.failPromptCount > 0 && msg.role === "user") {
        appendHook.failPromptCount -= 1;
        throw new Error("فشل حفظ السؤال المحاولة");
      }
      if (appendHook.failPlaceholderCount > 0 && msg.role === "assistant" && msg.status === "streaming") {
        appendHook.failPlaceholderCount -= 1;
        throw new Error("فشل حفظ بطاقة البث");
      }
      if (appendHook.failFinalOnce && msg.role === "assistant" && msg.status !== "streaming") {
        appendHook.failFinalOnce = false;
        throw new Error("فشل عابر في حفظ النتيجة الأساسية");
      }
      if (appendHook.failFinalCount > 0 && msg.role === "assistant" && msg.status !== "streaming") {
        appendHook.failFinalCount -= 1;
        throw new Error("فشل عابر في حفظ النتيجة الأساسية");
      }
      if (appendHook.holdFinal && msg.role === "assistant" && msg.status !== "streaming" && appendHook.holdFinalGate) {
        appendHook.onFinalHoldStart?.();
        await appendHook.holdFinalGate;
      }
      if (appendHook.failFinal && msg.role === "assistant" && msg.status !== "streaming") throw new Error("فشل حفظ النتيجة الأساسية");
      if (appendHook.failWarning && msg.sidecarWarning) throw new Error("فشل حفظ تحذير النتيجة");
      const result = await actual.appendMessage(msg);
      if (msg.status === "streaming" && msg.text.length > 0) appendHook.onCheckpoint?.();
      return result;
    },
  };
});

let n = 0;
async function mkSession(tag: string, over: Partial<SessionMeta> = {}): Promise<SessionMeta> {
  n += 1;
  const s: SessionMeta = { id: "sc" + n + tag, title: "جلسة اختبار", createdAt: Date.parse("2026-09-05T10:00:00Z"), updatedAt: 0, modelIds: [], primaryTarget: null, layoutMode: "vertical", onDisk: false, ...over };
  await createSession(s);
  return s;
}

const targets = [
  { targetId: "t1", providerId: "openrouter" as const, modelId: "openai/gpt-4o" },
  { targetId: "t2", providerId: "minimax" as const, modelId: "MiniMax-M2" },
];

function baseArgs(session: SessionMeta, over: Partial<SendArgs> = {}): SendArgs {
  const operationSignal = new AbortController().signal;
  return {
    session, turn: { id: `turn-${session.id}`, sharedPrompt: "سؤال مشترك؟", customs: {} },
    targets, syncMode: true,
    operationId: "op1",
    operationSignal,
    contextMode: "stateful",
    multiStepTools: false,
    historyFor: () => [],
    modelInfoFor: () => ({ id: "m", label: "نموذج", contextLength: 128000 }),
    apiKeyFor: () => "k", sessionHeaderFor: () => undefined,
    externalSignalFor: () => operationSignal, timeoutMs: 5000,
    ...over,
  };
}

function makeCb(): { c: { deltas: Record<string, string>; deltaOps: string[]; attemptIds: string[]; statuses: { op: string; targetId: string; status: ChatMessage["status"]; error?: string; attemptId: string }[]; dropped: string[]; droppedOps: string[]; appendedIds: string[]; warnings: string[] }; cb: SendCallbacks } {
  const c = {
    deltas: {} as Record<string, string>,
    deltaOps: [] as string[],
    attemptIds: [] as string[],
    statuses: [] as { op: string; targetId: string; status: ChatMessage["status"]; error?: string; attemptId: string }[],
    dropped: [] as string[],
    droppedOps: [] as string[],
    appendedIds: [] as string[],
    warnings: [] as string[],
  };
  const cb: SendCallbacks = {
    onDelta: (op, tid, ch, attemptId) => { c.deltaOps.push(op); c.attemptIds.push(attemptId); c.deltas[tid] = (c.deltas[tid] ?? "") + ch; },
    onStatus: (op, tid, st, err, attemptId) => { c.statuses.push({ op, targetId: tid, status: st, error: err, attemptId }); },
    onDropped: (op, ids, attemptId) => { c.droppedOps.push(op); c.dropped.push(...ids); if (!attemptId) throw new Error("missing attempt id"); },
    onAppended: (m) => { c.appendedIds.push(m.id); },
    onWarning: (message) => { c.warnings.push(message); },
  };
  return { c, cb };
}

beforeEach(async () => {
  await db.sessions.clear();
  await db.messages.clear();
  await db.usage_events.clear();
  await db.turns.clear();
  await db.tombstones.clear();
  await db.settings.clear();
  await db.operation_leases.clear();
  // Reset the module-global sink between tests without changing production APIs.
  setFileSink(null as unknown as FileSink);
  setTransportFetch(sseMockFetch());
  usageHook.failUsage = false;
  usageHook.calls = 0;
  dispatchHook.reject = false;
  dispatchHook.rejectAfterDispatch = false;
  dispatchHook.lateUpdateTarget = null;
  dispatchHook.lateUpdateChunk = "";
  dispatchHook.lateUpdateFired = false;
  dispatchHook.calls = 0;
  dispatchHook.overrideOutcomes = false;
  dispatchHook.outcomes = null;
  dispatchHook.lastArgs = null;
  persistenceHook.holdLookup = false;
  persistenceHook.lookupGate = null;
  persistenceHook.onLookupStart = null;
  persistenceHook.holdAttempt = false;
  persistenceHook.holdAttemptTurnId = "";
  persistenceHook.holdAttemptOperationId = "";
  persistenceHook.attemptGate = null;
  persistenceHook.onAttemptStart = null;
  appendHook.streamingCalls = 0;
  appendHook.holdAt = 0;
  appendHook.holdTarget = "";
  appendHook.holdGate = null;
  appendHook.onHoldStart = null;
  appendHook.onCheckpoint = null;
  appendHook.failFinal = false;
  appendHook.failFinalOnce = false;
  appendHook.holdFinal = false;
  appendHook.holdFinalGate = null;
  appendHook.onFinalHoldStart = null;
  appendHook.failFinalCount = 0;
  appendHook.failWarning = false;
  appendHook.failPromptCount = 0;
  appendHook.failPlaceholderCount = 0;
  attemptHook.failCount = 0;
  attemptHook.calls = 0;
});

afterEach(() => {
  setFileSink(null as unknown as FileSink);
});

vi.mock("@/lib/chat/dispatch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat/dispatch")>();
  return {
    ...actual,
    dispatchTurn: async (args: Parameters<typeof actual.dispatchTurn>[0]) => {
      dispatchHook.lastArgs = args;
      dispatchHook.calls += 1;
      if (dispatchHook.reject) throw new Error("رفض نداء dispatchTurn");
      if (dispatchHook.overrideOutcomes) return dispatchHook.outcomes ?? [];
      const outcomes = await actual.dispatchTurn(args);
      if (dispatchHook.rejectAfterDispatch) throw new Error("رفض بعد الإرسال");
      if (dispatchHook.lateUpdateTarget !== null) {
        const targetId = dispatchHook.lateUpdateTarget;
        const chunk = dispatchHook.lateUpdateChunk;
        setTimeout(() => {
          dispatchHook.lateUpdateFired = true;
          args.onUpdate?.(args.operationId, targetId, chunk);
        }, 0);
      }
      return outcomes;
    },
  };
});

describe("مُنشّط طبقة الملفات", () => {
  it("افتراضيًا بلا نشاط والقراءة تُفشل، وبعد setFileSink يتفعّل", async () => {
    expect(isFilePersistActive()).toBe(false);
    await expect(getFileSink().readFile("x")).rejects.toThrow(/لا ملفات/);
    setFileSink(memoryFileSink());
    expect(isFilePersistActive()).toBe(true);
  });
});

describe("sendTurn", () => {
  it("إلغاء أثناء انتظار placeholder لا يصل إلى dispatchTurn", async () => {
    let release!: () => void;
    let held!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const heldPromise = new Promise<void>((resolve) => { held = resolve; });
    appendHook.holdAt = 1;
    appendHook.holdGate = gate;
    appendHook.onHoldStart = held;
    const s = await mkSession("cancel-before-dispatch");
    const ac = new AbortController();
    const pending = sendTurn(baseArgs(s, {
      targets: [targets[0]],
      operationSignal: ac.signal,
      externalSignalFor: () => ac.signal,
    }), makeCb().cb);
    await heldPromise;
    ac.abort(new Error("ألغي العملية"));
    release();
    await pending;
    expect(dispatchHook.calls).toBe(0);
    expect((await getTurn(`turn-${s.id}`))?.attempts[0]?.status).toBe("stopped");
  });
  it("إلغاء أثناء حفظ النتيجة النهائية يبقي الحالة الطرفية متسقة", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let held!: () => void;
    const heldPromise = new Promise<void>((resolve) => { held = resolve; });
    appendHook.holdFinal = true;
    appendHook.holdFinalGate = gate;
    appendHook.onFinalHoldStart = held;
    const s = await mkSession("cancel-during-final");
    const ac = new AbortController();
    const pending = sendTurn(baseArgs(s, {
      targets: [targets[0]],
      operationSignal: ac.signal,
      externalSignalFor: () => ac.signal,
    }), makeCb().cb);
    await heldPromise;
    ac.abort(new Error("ألغي العملية"));
    release();
    await pending;
    const row = (await getMessages(s.id)).find((message) => message.role === "assistant");
    const turn = await getTurn("turn-" + s.id);
    expect(row?.status).toBe("done");
    expect(turn?.attempts[0]?.status).toBe("done");
    expect(usageHook.calls).toBe(0);
  });

  it("استبدال A أثناء انتظار حفظ المحاولة يبقي B هو المحاولة الوحيدة", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let held!: () => void;
    const heldPromise = new Promise<void>((resolve) => { held = resolve; });
    const s = await mkSession("integrated-replacement");
    const turnId = "turn-" + s.id;
    persistenceHook.holdAttempt = true;
    persistenceHook.holdAttemptTurnId = turnId;
    persistenceHook.holdAttemptOperationId = "opA";
    persistenceHook.attemptGate = gate;
    persistenceHook.onAttemptStart = held;
    const acA = new AbortController();
    const pendingA = sendTurn(baseArgs(s, {
      targets: [targets[0]],
      operationId: "opA",
      operationSignal: acA.signal,
      externalSignalFor: () => acA.signal,
    }), makeCb().cb);
    await heldPromise;
    acA.abort(new Error("ألغي A"));
    const acB = new AbortController();
    const { cb: cbB } = makeCb();
    await sendTurn(baseArgs(s, {
      targets: [targets[0]],
      operationId: "opB",
      operationSignal: acB.signal,
      externalSignalFor: () => acB.signal,
    }), cbB);
    release();
    await pendingA;
    expect(dispatchHook.calls).toBe(1);
    const record = await getTurn(turnId);
    expect(record?.attempts).toHaveLength(1);
    expect(record?.attempts[0]?.operationId).toBe("opB");
    expect(record?.attempts[0]?.attempt).toBe(1);
    const messages = (await getMessages(s.id)).filter((message) => message.role === "assistant");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.operationId).toBe("opB");
    expect(messages[0]?.attempt).toBe(record?.attempts[0]?.attempt);
    expect(messages[0]?.status).toBe("done");
  });

  it("إلغاء أثناء حفظ هدف نهائي لا يبدأ حفظ هدف لاحق", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let held!: () => void;
    const heldPromise = new Promise<void>((resolve) => { held = resolve; });
    appendHook.holdFinal = true;
    appendHook.holdFinalGate = gate;
    appendHook.onFinalHoldStart = held;
    const s = await mkSession("cancel-during-one-final");
    const ac = new AbortController();
    const { cb } = makeCb();
    const pending = sendTurn(baseArgs(s, { operationSignal: ac.signal, externalSignalFor: () => ac.signal }), cb);
    await heldPromise;
    ac.abort(new Error("ألغي العملية"));
    release();
    await pending;
    const rows = (await getMessages(s.id)).filter((message) => message.role === "assistant");
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.status === "done")).toHaveLength(1);
    expect(rows.filter((row) => row.status === "stopped")).toHaveLength(1);
    expect(usageHook.calls).toBe(0);
  });

  it("لا يبدأ dispatch عندما تكون الإشارة الخارجية مُلغاة مسبقًا", async () => {
    const s = await mkSession("pre-aborted");
    const external = new AbortController();
    external.abort(new Error("إلغاء قبل البدء"));
    await sendTurn(baseArgs(s, { targets: [targets[0]], externalSignalFor: () => external.signal }), makeCb().cb);
    expect(dispatchHook.calls).toBe(0);
    expect((await getMessages(s.id)).filter((m) => m.role === "assistant")).toHaveLength(0);
  });

  it("إلغاء أثناء انتظار سجل Turn لا ينشئ placeholder أو محاولة أو dispatch", async () => {
    let release!: () => void;
    let held!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const heldPromise = new Promise<void>((resolve) => { held = resolve; });
    persistenceHook.holdLookup = true;
    persistenceHook.lookupGate = gate;
    persistenceHook.onLookupStart = held;
    const s = await mkSession("cancel-lookup");
    const ac = new AbortController();
    const pending = sendTurn(baseArgs(s, { targets: [targets[0]], operationSignal: ac.signal, externalSignalFor: () => ac.signal }), makeCb().cb);
    await heldPromise;
    ac.abort(new Error("إلغاء أثناء قراءة السجل"));
    release();
    await pending;
    expect(dispatchHook.calls).toBe(0);
    expect((await getMessages(s.id)).filter((m) => m.role === "assistant")).toHaveLength(0);
    expect((await getTurn(`turn-${s.id}`))?.attempts ?? []).toHaveLength(0);
  });

  it("إلغاء أثناء انتظار حفظ المحاولة لا ينشئ placeholder أو dispatch", async () => {
    let release!: () => void;
    let held!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const heldPromise = new Promise<void>((resolve) => { held = resolve; });
    persistenceHook.holdAttempt = true;
    persistenceHook.attemptGate = gate;
    persistenceHook.onAttemptStart = held;
    const s = await mkSession("cancel-attempt");
    const ac = new AbortController();
    const pending = sendTurn(baseArgs(s, { targets: [targets[0]], operationSignal: ac.signal, externalSignalFor: () => ac.signal }), makeCb().cb);
    await heldPromise;
    ac.abort(new Error("إلغاء أثناء حفظ المحاولة"));
    release();
    await pending;
    expect(dispatchHook.calls).toBe(0);
    expect((await getMessages(s.id)).filter((m) => m.role === "assistant")).toHaveLength(0);
    expect((await getTurn(`turn-${s.id}`))?.attempts ?? []).toHaveLength(0);
  });

  it("يصل إلى حالة طرفية صريحة عند فشل النتيجة وتحديث المحاولة معًا", async () => {
    appendHook.failFinalCount = 2;
    attemptHook.failCount = 1;
    usageHook.failUsage = true;
    const s = await mkSession("combined-final-gate");
    const { c, cb } = makeCb();
    await sendTurn(baseArgs(s, { targets: [targets[0]] }), cb);

    const row = (await getMessages(s.id)).find((message) => message.role === "assistant");
    const turn = await getTurn("turn-" + s.id);
    expect(row).toMatchObject({ status: "error", error: "تعذر حفظ النتيجة الأساسية" });
    expect(turn?.attempts[0]?.status).toBe("error");
    expect(usageHook.calls).toBe(0);
    expect(c.warnings.some((warning) => warning.includes("تعذر تثبيت"))).toBe(true);
  });

  it("لا يبدأ sidecars عند فشل النتيجة الأساسية ويبلغ عن حالة طرفية صريحة", async () => {
    appendHook.failFinal = true;
    usageHook.failUsage = true;
    const s = await mkSession("final-gate");
    const { c, cb } = makeCb();
    await sendTurn(baseArgs(s, { targets: [targets[0]] }), cb);
    expect(usageHook.calls).toBe(0);
    expect(c.warnings.some((warning) => warning.includes("تعذر تثبيت"))).toBe(true);
    expect(c.statuses.some((status) => status.status === "error")).toBe(true);
  });

  it("يعيد بناء البطاقة الأساسية كحالة خطأ ح，明确 من محاولة طرفية عند فشل الحفظ النهائي", async () => {
    appendHook.failFinal = true;
    const s = await mkSession("reconcile-final-error");
    const { cb } = makeCb();
    await sendTurn(baseArgs(s, { targets: [targets[0]] }), cb);
    const before = (await getMessages(s.id)).find((message) => message.role === "assistant");
    const turnBefore = await getTurn("turn-" + s.id);
    expect(before?.status).toBe("streaming");
    expect(turnBefore?.attempts[0]?.status).toBe("error");

    expect(await reconcileInterruptedTurns(new Set())).toBe(1);
    const after = (await getMessages(s.id)).find((message) => message.role === "assistant");
    expect(after).toMatchObject({ status: "error", text: before?.text });
    expect(after?.error).toBeTruthy();
  });

  it("يكتشف عقد outcomes غير مكتمل أو مكرر ولا يترك بطاقة بث أو sidecar نجاح", async () => {
    const cases: DispatchOutcome[][] = [
      [],
      [{ targetId: "wrong", operationId: "op1", status: "done", text: "wrong", ms: 1 }],
      [
        { targetId: "t1", operationId: "op1", status: "done", text: "one", ms: 1 },
        { targetId: "t1", operationId: "op1", status: "done", text: "duplicate", ms: 1 },
      ],
      [
        { targetId: "t1", operationId: "op1", status: "done", text: "one", ms: 1 },
        { targetId: "unknown", operationId: "op1", status: "done", text: "unknown", ms: 1 },
      ],
      [{ targetId: "t1", operationId: "op1", status: "done", text: "one", ms: 1 }],
      [{ targetId: "t1", operationId: "other", status: "done", text: "wrong operation", ms: 1 }],
    ];
    for (const [index, outcomes] of cases.entries()) {
      const s = await mkSession("outcome-contract-" + index);
      dispatchHook.overrideOutcomes = true;
      dispatchHook.outcomes = outcomes;
      const { c, cb } = makeCb();
      await sendTurn(baseArgs(s, { targets }), cb);
      const rows = (await getMessages(s.id)).filter((m) => m.role === "assistant");
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.status === "error")).toBe(true);
      expect(usageHook.calls).toBe(0);
      expect(c.warnings.some((warning) => warning.includes("تعذر"))).toBe(true);
    }
  });

  it("إرسال موحد: يحفظ السؤال والنتائج النهائية ويسجل الاستهلاك ويبث الدلتا", async () => {
    const s = await mkSession("ok");
    const { c, cb } = makeCb();
    const msgs = await sendTurn(baseArgs(s), cb);
    expect(c.dropped).toEqual([]);
    expect(msgs).toHaveLength(2);
    const all = await getMessages(s.id);
    const shared = all.find((m) => m.role === "user");
    expect(shared?.text).toBe("سؤال مشترك؟");
    const results = all.filter((m) => m.role === "assistant");
    expect(results.map((r) => r.targetId).sort()).toEqual(["t1", "t2"]);
    expect(results.every((r) => r.status === "done" && r.text === "أهلاً")).toBe(true);
    expect(c.deltas["t1"]).toBe("أهلاً");
    expect(c.statuses.map((x) => x.status)).toEqual(["done", "done"]);
    expect(c.appendedIds).toHaveLength(5); // سؤال + بطاقتا بث + نتيجتان نهائيتان
    const usage = await getUsageEvents({ sessionId: s.id });
    expect(usage).toHaveLength(2);
    expect(usage.every((u) => u.status === "ok" && u.inputTokens === 7 && u.outputTokens === 3)).toBe(true);
    expect(usage.every((u) => u.operationId === "op1" && u.attemptId === c.attemptIds[0])).toBe(true);
    const persistedTurn = await getTurn("turn-" + s.id);
    expect(persistedTurn?.attempts).toHaveLength(1);
    expect(c.attemptIds.every((attemptId) => attemptId === persistedTurn?.attempts[0]?.id)).toBe(true);
    expect(c.statuses.every((status) => status.attemptId === persistedTurn?.attempts[0]?.id)).toBe(true);
  });

  it("السؤال المخصص يُحفظ رسالة مستخدم promptKind=custom مرتبطة بالهدف", async () => {
    const s = await mkSession("custom");
    await sendTurn(baseArgs(s, { syncMode: false, turn: { id: `turn-${s.id}`, sharedPrompt: "مشترك", customs: { t1: "خاص" } } }), makeCb().cb);
    const all = await getMessages(s.id);
    const custom = all.find((m) => m.promptKind === "custom");
    expect(custom?.targetId).toBe("t1");
    expect(custom?.text).toContain("خاص");
    const t2 = all.find((m) => m.targetId === "t2" && m.role === "assistant");
    expect(t2?.text).toBe("أهلاً");
  });

  it("هدف يفشل: النتيجة error مع رسالة مترجمة والبقية done وحدث استهلاك خطأ", async () => {
    const f = sseMockFetch();
    setTransportFetch(((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes("minimax") ? new Response("{}", { status: 401 }) : f(input, init)) as typeof fetch);
    const s = await mkSession("err");
    const { c, cb } = makeCb();
    await sendTurn(baseArgs(s), cb);
    const results = (await getMessages(s.id)).filter((m) => m.role === "assistant");
    const t2 = results.find((r) => r.targetId === "t2")!;
    const t1 = results.find((r) => r.targetId === "t1")!;
    expect(t2.status).toBe("error");
    expect(t2.error).toMatch(/مفتاح/);
    expect(t1.status).toBe("done");
    expect(c.statuses.find((x) => x.targetId === "t2")?.error).toMatch(/مفتاح/);
    const usage = await getUsageEvents({ sessionId: s.id });
    expect(usage.find((u) => u.status === "error")).toBeTruthy();
    expect(usage.find((u) => u.status === "ok")).toBeTruthy();
  });

  it("الحفظ المزدوج: meta.json أولًا ثم قسم تمرّة واحد لكل إرسال بكل النتائج", async () => {
    const sink = memoryFileSink();
    setFileSink(sink);
    expect(isFilePersistActive()).toBe(true);
    const s = await mkSession("disk", { onDiskDir: "2026-09-05_جلسة-اختبار_disk00001" });
    const dir = "sessions/" + s.onDiskDir;
    await sendTurn(baseArgs(s), makeCb().cb);
    const md = await sink.readFile(dir + "/session.md");
    expect(md).toContain("# جلسة: جلسة اختبار");
    expect((md.match(/## تمرّة/g) || []).length).toBe(1);
    expect(md).toContain("### openrouter — openai/gpt-4o");
    expect(md).toContain("أهلاً");
    expect(await sink.exists(dir + "/turns/t01/00_shared-prompt.md")).toBe(true);
    const meta = JSON.parse(await sink.readFile(dir + "/meta.json"));
    expect(meta.turns).toHaveLength(1);
    const persistedAttempt = (await getTurn("turn-" + s.id))?.attempts[0];
    // Non-vacuous: the archive identity is only meaningful if the durable attempt was
    // actually found, otherwise both sides could be undefined and the check would pass.
    expect(persistedAttempt, "the archived turn must have a durable attempt record").toBeDefined();
    expect(persistedAttempt?.operationId).toBe("op1");
    expect(meta.turns[0].operationId).toBe("op1");
    expect(meta.turns[0].attemptId).toBe(persistedAttempt?.id);
    expect(meta.turns[0].attemptId).toEqual(expect.any(String));
    expect((await getSession(s.id))?.onDisk).toBe(true);
    await sendTurn(baseArgs({ ...s, onDisk: true }, { operationId: "op2-disk", turn: { id: `turn2-${s.id}`, sharedPrompt: "سؤال ثانٍ", customs: {} } }), makeCb().cb);
    const md2 = await sink.readFile(dir + "/session.md");
    expect((md2.match(/## تمرّة/g) || []).length).toBe(2);
    expect(JSON.parse(await sink.readFile(dir + "/meta.json")).turns).toHaveLength(2);
  });

  it("meta.json موجود مسبقًا بتمرّات لا تمحه كتابة الميتا الأولية", async () => {
    const sink = memoryFileSink();
    setFileSink(sink);
    const s = await mkSession("guard", { onDiskDir: "guarddir" });
    // A valid legacy (v1) entry: a malformed manifest is now rejected by validation.
    await sink.writeFile("sessions/guarddir/meta.json", JSON.stringify({
      meta: s,
      turns: [{
        turn: { id: "kept-turn", sharedPrompt: "سؤال محفوظ", customs: {} },
        prompts: [{ targetId: "k1", providerId: "openrouter", modelId: "gpt-4o", text: "سؤال محفوظ", hasShared: true, hasCustom: false }],
        results: [{ targetId: "k1", text: "جواب محفوظ", usage: null }],
        status: { k1: "done" }, errors: {}, createdAt: 1, dirName: "turns/t01",
      }],
    }));
    await sendTurn(baseArgs(s), makeCb().cb);
    const meta = JSON.parse(await sink.readFile("sessions/guarddir/meta.json"));
    expect(meta.schemaVersion).toBe(2);
    expect(meta.turns).toHaveLength(2);
    expect(meta.turns[0].turnId).toBe("kept-turn");
    expect(meta.turns[0].results[0].text).toBe("جواب محفوظ");
  });

  it("بلا onDiskDir: لا تُكتب ملفات ولا يُحدَّث onDisk", async () => {
    const sink = memoryFileSink();
    setFileSink(sink);
    const s = await mkSession("web");
    await sendTurn(baseArgs(s), makeCb().cb);
    expect(sink.tree()).toEqual([]);
    expect((await getSession(s.id))?.onDisk).toBe(false);
  });

  it("هدف بلا سؤال يُسقط مع onDropped والبقية تُرسل", async () => {
    const s = await mkSession("drop");
    const { c, cb } = makeCb();
    await sendTurn(baseArgs(s, { syncMode: false, turn: { id: `t-${s.id}`, sharedPrompt: null, customs: { t1: "خاص فقط" } } }), cb);
    expect(c.dropped).toEqual(["t2"]);
    const results = (await getMessages(s.id)).filter((m) => m.role === "assistant");
    expect(results.map((r) => r.targetId)).toEqual(["t1"]);
    expect(c.statuses).toHaveLength(1);
  });

  it("الإيقاف الخارجي أثناء البث: النتيجة stopped بنص البدء (نص جزئي محفوظ) ولها attemptId", async () => {
    // بث يُرسل جزءًا أوليًا ثم يتجمّد: الإيقاف لا يعيد وضع خطأ ولا يمحو النص
    let emitted = false;
    const hang = (async (input: RequestInfo | URL) => {
      await new Promise((r) => setTimeout(r, 0));
      const head = "data: " + JSON.stringify({ choices: [{ delta: { content: "بداية" } }] }) + "\n\n";
      if (String(input).includes("minimax")) {
        // الهدف الثاني يُبث النص الجزئي نفسه ثم يتيكم: الإلغاء يحسم نتيجته
        return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(head)); emitted = true; } }), { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return sseResponse(["أهلاً"]);
    }) as unknown as typeof fetch;
    setTransportFetch(hang);
    const s = await mkSession("cancel");
    const ac = new AbortController();
    const { cb } = makeCb();
    const pending = sendTurn(baseArgs(s, { externalSignalFor: () => ac.signal, timeoutMs: 5000 }), cb);
    await new Promise((r) => setTimeout(r, 60));
    expect(emitted).toBe(true);
    ac.abort(new Error("ألغي بواسطة المستخدم"));
    const msgs = await pending;
    const t2 = (await getMessages(s.id)).find((m) => m.targetId === "t2" && m.role === "assistant")!;
    expect(t2.status).toBe("stopped");
    expect(t2.text).toBe("بداية");
    expect(t2.error).toBeUndefined();
    expect(msgs.find((m) => m.targetId === "t2")?.attemptId).toBe(t2.attemptId);
  });

  it("فشل حفظ السؤال الموحد بعد المحاولة يترك حالة طرفية صريحة", async () => {
    appendHook.failPromptCount = 1;
    setTransportFetch((() => sseResponse(["لا"]) ) as unknown as typeof fetch);
    const s = await mkSession("prompt-fail");
    const { c, cb } = makeCb();
    await sendTurn(baseArgs(s, { targets: [targets[0]] }), cb).catch(() => undefined);
    const turn = await getTurn("turn-" + s.id);
    expect(turn?.attempts[0]?.status, "a persisted attempt must never stay streaming after a setup failure").toBe("error");
    expect((await getMessages(s.id)).some((m) => m.status === "streaming")).toBe(false);
    expect(c.statuses.every((x) => x.status !== "streaming")).toBe(true);
  });

  it("فشل حفظ السؤال المخصص بعد المحاولة يترك حالة طرفية صريحة", async () => {
    appendHook.failPromptCount = 1;
    setTransportFetch((() => sseResponse(["لا"])) as unknown as typeof fetch);
    const s = await mkSession("custom-fail");
    const { cb } = makeCb();
    await sendTurn(baseArgs(s, {
      targets: [targets[0]],
      syncMode: false,
      turn: { id: "turn-" + s.id, sharedPrompt: "سؤال مشترك؟", customs: { t1: "سؤال مخصص" } },
    }), cb).catch(() => undefined);
    const turn = await getTurn("turn-" + s.id);
    expect(turn?.attempts[0]?.status).toBe("error");
    expect((await getMessages(s.id)).some((m) => m.status === "streaming")).toBe(false);
  });

  it("فشل حفظ بطاقة البث بعد المحاولة يترك حالة طرفية صريحة", async () => {
    appendHook.failPlaceholderCount = 1;
    setTransportFetch((() => sseResponse(["لا"])) as unknown as typeof fetch);
    const s = await mkSession("placeholder-fail");
    const { cb } = makeCb();
    await sendTurn(baseArgs(s, { targets: [targets[0]] }), cb).catch(() => undefined);
    const turn = await getTurn("turn-" + s.id);
    expect(turn?.attempts[0]?.status, "a placeholder failure must not strand a streaming attempt").toBe("error");
    expect((await getMessages(s.id)).some((m) => m.status === "streaming")).toBe(false);
  });

  it("فشل تحديث حالة المحاولة عند الإيقاف يُبقي الصف متوقفًا وينبّه بحدود", async () => {
    // The stopped primary row is accepted, but every attempt-status update fails.
    // The terminal message must survive and the inconsistency must be reported.
    attemptHook.failCount = 99;
    let emitted = false;
    const hang = (async (input: RequestInfo | URL) => {
      await new Promise((r) => setTimeout(r, 0));
      const head = "data: " + JSON.stringify({ choices: [{ delta: { content: "بداية" } }] }) + "\n\n";
      if (String(input).includes("minimax")) {
        return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(head)); emitted = true; } }), { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return sseResponse(["أهلاً"]);
    }) as unknown as typeof fetch;
    setTransportFetch(hang);
    const s = await mkSession("cancel-attempt");
    const ac = new AbortController();
    const { c, cb } = makeCb();
    const pending = sendTurn(baseArgs(s, { operationSignal: ac.signal, timeoutMs: 5000 }), cb);
    await new Promise((r) => setTimeout(r, 60));
    expect(emitted).toBe(true);
    ac.abort(new Error("ألغي بواسطة المستخدم"));
    await pending;
    const t2 = (await getMessages(s.id)).find((m) => m.targetId === "t2" && m.role === "assistant")!;
    expect(t2.status, "the terminal primary row must survive a failed attempt update").toBe("stopped");
    expect(t2.error).toBeUndefined();
    expect(c.warnings).toContain("تعذر تحديث حالة المحاولة بعد الإيقاف");
    // The failed attempt update must not be reported as success: the attempt record is
    // still streaming, and the warning is the only bounded signal of that inconsistency.
    const turn = await getTurn("turn-" + s.id);
    expect(turn?.attempts.some((a) => a.status === "streaming")).toBe(true);
  });

  it("خطأ منتصف البث: يبث الجزء الواصل ثم يفشل النتيجة (تحصين المهمة 8-أ)", async () => {
    const line = "data: " + JSON.stringify({ choices: [{ delta: { content: "بداية" } }] }) + "\n\n";
    const f = (async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(line)); setTimeout(() => c.error(new Error("انقطع الاتصال بالبث")), 20); } }), { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
    setTransportFetch(f);
    const s = await mkSession("midstream");
    const { c, cb } = makeCb();
    await sendTurn(baseArgs(s, { targets: [targets[0]] }), cb);
    expect(c.deltas["t1"]).toBe("بداية");
    const t1 = (await getMessages(s.id)).find((m) => m.targetId === "t1" && m.role === "assistant")!;
    expect(t1.status).toBe("error");
    expect(t1.error).toBeTruthy();
    // [المهمة 5] النص الجزئي الواصل قبل الانقطاع يُحفظ في الصف النهائي ولا يُمحى
    expect(t1.text).toBe("بداية");
    const usage = await getUsageEvents({ sessionId: s.id });
    expect(usage.find((u) => u.status === "error")).toBeTruthy();
  });

  it("operationId يتدفق عبر مرحّات onDelta/onStatus وكل صف محفوظ", async () => {
    const s = await mkSession("op");
    const { c, cb } = makeCb();
    const msgs = await sendTurn(baseArgs(s), cb);
    expect(c.deltaOps.length).toBeGreaterThan(0);
    expect(c.deltaOps.every((o) => o === "op1")).toBe(true);
    expect(c.statuses).toHaveLength(2);
    expect(c.statuses.every((x) => x.op === "op1")).toBe(true);
    expect(c.droppedOps).toEqual([]);
    const all = await getMessages(s.id);
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all.every((m) => m.operationId === "op1")).toBe(true);
    expect(msgs.every((m) => m.operationId === "op1")).toBe(true);
  });

  it("onDropped يمرر operationId قبل الهويات المُسقَطة", async () => {
    const s = await mkSession("opdrop");
    const { c, cb } = makeCb();
    await sendTurn(baseArgs(s, { syncMode: false, turn: { id: `t-${s.id}`, sharedPrompt: null, customs: { t1: "خاص فقط" } } }), cb);
    expect(c.dropped).toEqual(["t2"]);
    expect(c.droppedOps).toEqual(["op1"]);
  });

  it("السياق الحالي: stateful يمرر السجلات السابقة إلى dispatch وstateless يرسل السؤال وحده", async () => {
    const s = await mkSession("ctx");
    await sendTurn(baseArgs(s), makeCb().cb);
    const history = (await getMessages(s.id)).filter((m) => m.sessionId === s.id);
    const f2 = sseMockFetch();
    setTransportFetch(f2);
    const tt = { id: `turn2-${s.id}`, sharedPrompt: "سؤال ثانٍ", customs: {} };
    await sendTurn(baseArgs(s, { operationId: "op2-context", turn: tt, historyFor: () => history }), makeCb().cb);
    const body2 = f2.calls[0]?.body ?? "";
    expect(body2).toContain("سؤال مشترك؟");
    expect(body2).toContain("سؤال ثانٍ");
    const f3 = sseMockFetch();
    setTransportFetch(f3);
    await sendTurn(baseArgs(s, { operationId: "op3-context", turn: { id: `turn3-${s.id}`, sharedPrompt: "سؤال ثالث", customs: {} }, contextMode: "stateless" }), makeCb().cb);
    const body3 = f3.calls[0]?.body ?? "";
    expect(body3).toContain("سؤال ثالث");
    expect(body3).not.toContain("سؤال مشترك؟");
    expect(body3).not.toContain("سؤال ثانٍ");
  });

  it("assistantIds يعيد استخدام معرف الرسالة عند إعادة المحاولة فلا يتكرر الصف", async () => {
    const s = await mkSession("retry");
    const one = [targets[0]];
    const first = await sendTurn(baseArgs(s, { targets: one }), makeCb().cb);
    const reused = await sendTurn(baseArgs(s, { operationId: "op2-retry", targets: one, assistantIds: { t1: first[0].id }, assistantCreatedAts: { t1: first[0].createdAt } }), makeCb().cb);
    expect(reused[0].id).toBe(first[0].id);
    expect(reused[0].createdAt).toBe(first[0].createdAt);
    const results = (await getMessages(s.id)).filter((m) => m.role === "assistant");
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe("أهلاً");
  });

  it("multiStepTools وtool callbacks تمر من sendTurn إلى dispatchTurn", async () => {
    const s = await mkSession("tool-forward");
    const { cb } = makeCb();
    cb.onToolExecutionStart = () => {};
    cb.onToolExecutionEnd = () => {};
    await sendTurn(baseArgs(s, { targets: [targets[0]], multiStepTools: true }), cb);
    expect(dispatchHook.lastArgs?.multiStepTools).toBe(true);
    expect(dispatchHook.lastArgs?.onToolExecutionStart).toBe(cb.onToolExecutionStart);
    expect(dispatchHook.lastArgs?.onToolExecutionEnd).toBe(cb.onToolExecutionEnd);
  });
});

describe("المهمة 5 — الإسناد الدائم للبث الجزئي", () => {
  it("attemptId واحد لكل نداء إرسال: يُرفق بصفوف السؤال والبث والنتيجة وحدث الاستهلاك", async () => {
    const s = await mkSession("attempt");
    const { cb } = makeCb();
    await sendTurn(baseArgs(s), cb);
    const all = await getMessages(s.id);
    const ids = new Set(all.map((m) => m.attemptId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toBeTruthy();
    const usage = await getUsageEvents({ sessionId: s.id });
    expect(usage.length).toBeGreaterThan(0);
    expect(usage.every((u) => u.attemptId === [...ids][0])).toBe(true);
  });

  it("لا يصرّف نقطة حفظ موضوعة في الطابور بعد الإلغاء", async () => {
    let release!: () => void;
    const holdGate = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    appendHook.holdAt = 2;
    appendHook.holdGate = holdGate;
    appendHook.onHoldStart = started;
    const makeChunk = (content: string) => new TextEncoder().encode("data: " + JSON.stringify({ choices: [{ delta: { content } }] }) + "\n\n");
    const f = (async () => new Response(new ReadableStream({ start(c) {
      c.enqueue(makeChunk("بداية"));
      c.enqueue(makeChunk("x".repeat(600)));
      c.enqueue(makeChunk("y".repeat(600)));
    } }), { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
    setTransportFetch(f);
    const s = await mkSession("queued");
    const ac = new AbortController();
    const { c, cb } = makeCb();
    const pending = sendTurn(baseArgs(s, { targets: [targets[0]], externalSignalFor: () => ac.signal }), cb);
    await startedPromise;
    await vi.waitFor(() => expect(c.deltas["t1"]).toBe("بداية" + "x".repeat(600) + "y".repeat(600)), { timeout: 3000 });
    expect(appendHook.streamingCalls).toBe(2);
    ac.abort(new Error("ألغي بواسطة المستخدم"));
    release();
    await pending;
    expect(appendHook.streamingCalls).toBe(2);
    const row = (await getMessages(s.id)).find((m) => m.targetId === "t1" && m.role === "assistant")!;
    expect(row.status).toBe("stopped");
    expect(row.text).toBe("بداية" + "x".repeat(600) + "y".repeat(600));
  });

  it("يغلق كل الأهداف قبل انتظار طابور الهدف الأول فلا يقبل تحديثًا متأخرًا للهدف الثاني", async () => {
    let release!: () => void;
    const holdGate = new Promise<void>((resolve) => { release = resolve; });
    let held!: () => void;
    const heldPromise = new Promise<void>((resolve) => { held = resolve; });
    appendHook.holdTarget = "t1";
    appendHook.holdGate = holdGate;
    appendHook.onHoldStart = held;
    dispatchHook.lateUpdateTarget = "t2";
    dispatchHook.lateUpdateChunk = "تحديث متأخر";
    setTransportFetch((() => sseResponse(["x".repeat(600)])) as unknown as typeof fetch);
    const s = await mkSession("close-all");
    const { c, cb } = makeCb();
    const pending = sendTurn(baseArgs(s), cb);
    await heldPromise;
    await vi.waitFor(() => expect(dispatchHook.lateUpdateFired).toBe(true), { timeout: 3000 });
    release();
    await pending;
    expect(c.deltas.t2).not.toContain("تحديث متأخر");
  });

  it("نقطة حفظ أثناء البث: صف بنص جزئي يُكتب قبل النتيجة ثم الصف النهائي بالنص الكامل", async () => {
    const line = "data: " + JSON.stringify({ choices: [{ delta: { content: "بداية" } }] }) + "\n\n";
    const big = "data: " + JSON.stringify({ choices: [{ delta: { content: "x".repeat(600) } }] }) + "\n\n";
    const f = (async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(line)); c.enqueue(new TextEncoder().encode(big)); setTimeout(() => c.error(new Error("انقطع الاتصال بالبث")), 80); } }), { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
    setTransportFetch(f);
    const s = await mkSession("ckpt");
    const { cb } = makeCb();
    await sendTurn(baseArgs(s, { targets: [targets[0]] }), cb);
    const t1 = (await getMessages(s.id)).find((m) => m.targetId === "t1" && m.role === "assistant")!;
    // النتيجة النهائية بأحداث خطأ تحفظ النص الكامل المتراكم
    expect(t1.text).toBe("بداية" + "x".repeat(600));
    expect(t1.status).toBe("error");
  });

  it("استثناء onDelta لا يقطع تجميع النص أو حفظ نقطة الحفظ", async () => {
    const s = await mkSession("callbackthrow");
    const { cb } = makeCb();
    let calls = 0;
    cb.onDelta = () => {
      calls += 1;
      throw new Error("فشل واجهة البث");
    };
    setTransportFetch((() => sseResponse(["بداية", "نهاية"])) as unknown as typeof fetch);
    await sendTurn(baseArgs(s, { targets: [targets[0]] }), cb);
    const row = (await getMessages(s.id)).find((m) => m.targetId === "t1" && m.role === "assistant")!;
    expect(calls).toBeGreaterThan(0);
    expect(row.status).toBe("done");
    expect(row.text).toBe("بدايةنهاية");
  });

  it.each(["onAppended", "onStatus"] as const)("استثناء مراقب %s لا يوقف صفوف الأهداف النهائية", async (observer) => {
    const sink = memoryFileSink();
    setFileSink(sink);
    const s = await mkSession("observer-" + observer, { onDiskDir: "observer-" + observer });
    const { cb } = makeCb();
    let observerCalls = 0;
    if (observer === "onAppended") {
      cb.onAppended = (m) => {
        if (m.role === "assistant" && m.status !== "streaming") {
          observerCalls += 1;
          throw new Error("فشل مراقب الإضافة");
        }
      };
    } else {
      cb.onStatus = () => {
        observerCalls += 1;
        throw new Error("فشل مراقب الحالة");
      };
    }
    setTransportFetch((() => sseResponse(["نص نهائي"])) as unknown as typeof fetch);
    const result = await sendTurn(baseArgs(s), cb);
    const rows = (await getMessages(s.id)).filter((m) => m.role === "assistant");
    expect(observerCalls).toBe(2);
    expect(result).toHaveLength(2);
    expect(rows).toHaveLength(2);
    expect(rows.every((m) => m.status === "done" && m.text === "نص نهائي")).toBe(true);
    const archived = JSON.parse(await sink.readFile("sessions/observer-" + observer + "/meta.json")).turns[0];
    expect(archived.results).toHaveLength(2);
    expect(archived.results.every((r: { text: string }) => r.text === "نص نهائي")).toBe(true);
    expect(Object.values(archived.status)).toEqual(["done", "done"]);
  });

  it.each(["onAppended", "onStatus", "onDelta"] as const)("رفض مراقب %s غير المتزامن لا يسرّب ولا يوقف الصفوف", async (observer) => {
    const sink = memoryFileSink();
    setFileSink(sink);
    const s = await mkSession("async-observer-" + observer, { onDiskDir: "async-observer-" + observer });
    const { cb } = makeCb();
    let calls = 0;
    if (observer === "onAppended") {
      cb.onAppended = async (m) => {
        if (m.role === "assistant" && m.status !== "streaming") {
          calls += 1;
          await Promise.resolve();
          throw new Error("رفض مراقب الإضافة");
        }
      };
    } else if (observer === "onStatus") {
      cb.onStatus = async () => {
        calls += 1;
        await Promise.resolve();
        throw new Error("رفض مراقب الحالة");
      };
    } else {
      cb.onDelta = async () => {
        calls += 1;
        await Promise.resolve();
        throw new Error("رفض مراقب الدلتا");
      };
    }
    setTransportFetch((() => sseResponse(["نص نهائي"])) as unknown as typeof fetch);
    const result = await sendTurn(baseArgs(s), cb);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const rows = (await getMessages(s.id)).filter((m) => m.role === "assistant");
    expect(calls).toBe(2);
    expect(result).toHaveLength(2);
    expect(rows).toHaveLength(2);
    expect(rows.every((m) => m.status === "done" && m.text === "نص نهائي")).toBe(true);
    const archived = JSON.parse(await sink.readFile("sessions/async-observer-" + observer + "/meta.json")).turns[0];
    expect(archived.results.every((r: { text: string }) => r.text === "نص نهائي")).toBe(true);
  });

  it("يعيد محاولة حفظ النتيجة الأساسية العابرة ثم يبقي المسار والثراثات متسقة", async () => {
    appendHook.failFinalOnce = true;
    const sink = memoryFileSink();
    setFileSink(sink);
    const s = await mkSession("transient-final", { onDiskDir: "transient-final" });
    const { cb } = makeCb();
    await sendTurn(baseArgs(s, { targets: [targets[0]] }), cb);
    const row = (await getMessages(s.id)).find((m) => m.role === "assistant");
    expect(row).toMatchObject({ status: "done", text: "أهلاً" });
    expect(usageHook.calls).toBe(1);
    expect(sink.tree().some((path) => path.startsWith("sessions/transient-final/turns/"))).toBe(true);
  });

  it("عزل ثراث الاستهلاك: فشل recordUsage لا يمحو الصف الأساسي ولا يرفض الإرسال ويضيف تحذيرًا", async () => {
    usageHook.failUsage = true;
    const s = await mkSession("usagefail");
    const { cb } = makeCb();
    const msgs = await sendTurn(baseArgs(s), cb);
    await new Promise((r) => setTimeout(r, 30));
    const row = (await getMessages(s.id)).find((m) => m.targetId === "t1" && m.role === "assistant")!;
    expect(row.status).toBe("done");
    expect(row.text).toBe("أهلاً");
    expect(row.sidecarWarning).toBeTruthy();
    expect(msgs[0].text).toBe("أهلاً");
  });

  it("يسقط إلى onWarning إذا فشل حفظ صف تحذير sidecar نفسه", async () => {
    usageHook.failUsage = true;
    appendHook.failWarning = true;
    const s = await mkSession("warning-fallback");
    const { c, cb } = makeCb();
    await sendTurn(baseArgs(s, { targets: [targets[0]] }), cb);
    expect(c.warnings.some((warning) => warning.includes("تعذر حفظ"))).toBe(true);
  });

  it("عزل ثراث الأرشفة: فشل كتابة الملفات لا يمحو الصف الأساسي ويضيف تحذيرًا جانبيًا", async () => {
    const sink = memoryFileSink();
    // الفشل في session.md فقط: صف الأولوية هو الدكسي، والأرشفة (appendTurn) ثراث جانبي
    const failing: typeof sink = { ...sink, writeFile: async (path: string, data: string) => {
      if (path.includes("session.md")) throw new Error("قرص ممتلئ");
      return sink.writeFile(path, data);
    } };
    setFileSink(failing);
    const s = await mkSession("archfail", { onDiskDir: "archfaildir" });
    const { cb } = makeCb();
    await sendTurn(baseArgs(s), cb);
    await new Promise((r) => setTimeout(r, 30));
    const row = (await getMessages(s.id)).find((m) => m.targetId === "t1" && m.role === "assistant")!;
    expect(row.status).toBe("done");
    expect(row.text).toBe("أهلاً");
    expect(row.sidecarWarning).toBeTruthy();
  });
});

describe("المهمة 5 — تنظيف نقاط الحفظ وقرض رفض النداء", () => {
  it("قرض رفض النداء: لا صف بث معلق، وكل هدف يحصل صف خطأ نهائي بنصه المتراكم ومعرف المحاولة", async () => {
    dispatchHook.reject = true;
    const s = await mkSession("reject");
    const { cb } = makeCb();
    const msgs = await sendTurn(baseArgs(s), cb);
    await new Promise((r) => setTimeout(r, 300));
    const all = (await getMessages(s.id)).filter((m) => m.role === "assistant");
    expect(all.length).toBe(2);
    expect(all.every((m) => m.status === "error")).toBe(true);
    expect(all.every((m) => (m.error ?? "").includes("رفض نداء dispatchTurn"))).toBe(true);
    // لا صف بث متدلٍ: كل هدف صف واحد فقط (الكتابات تحل محلها put بالمفتاح نفسه)
    const t1rows = all.filter((m) => m.targetId === "t1");
    expect(t1rows).toHaveLength(1);
    expect(msgs[0].attemptId).toBeTruthy();
    // تنظيف المؤقتات: لا نقاط حفظ تفتح بعد الحسم (لا صفوف إضافية)
    await new Promise((r) => setTimeout(r, 300));
    expect(await getMessages(s.id).then((rows) => rows.filter((m) => m.role === "assistant"))).toHaveLength(2);
  });

  it("نقطة حفظ المرصودة أثناء البث: صف بث بنص جزئي يظهر قبل النتيجة النهائية (كل 250مك/512 محرف)", async () => {
        const hold = (async () => new Response(new ReadableStream({
      async start(c) {
        const enc = new TextEncoder();
        const send = (text: string) => enc.encode("data: " + JSON.stringify({ choices: [{ delta: { content: text } }] }) + "\n\n");
        c.enqueue(send("بداية"));
        c.enqueue(send("x".repeat(600)));
        // تعليق البث بعد المحارف: نقطة الحفظ العتبة تُطلق أثناء التعليق
        await new Promise(() => {});
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
    setTransportFetch(hold);
    const s = await mkSession("ckptobs");
    const ac = new AbortController();
    const { cb } = makeCb();
    dispatchHook.rejectAfterDispatch = true;
    let checkpointWritten!: () => void;
    const checkpointCommitted = new Promise<void>((resolve) => { checkpointWritten = resolve; });
    appendHook.onCheckpoint = checkpointWritten;
    const pending = sendTurn(baseArgs(s, { targets: [targets[0]], operationSignal: ac.signal, externalSignalFor: () => ac.signal }), cb);
    await checkpointCommitted;
    appendHook.onCheckpoint = null;
    const mid = (await getMessages(s.id)).find((m) => m.targetId === "t1" && m.role === "assistant")!;
    // نقطة الحفظ المرصودة: نفس معرف الرسالة، نص جزئي محفوظ(case للتدفق جزئي قبل الحسم)
    expect([mid.status, mid.text.includes("بداية")]).toEqual(["streaming", true]);
    ac.abort(new Error("ألغي بواسطة المستخدم"));
    await pending;
    const final = (await getMessages(s.id)).find((m) => m.targetId === "t1" && m.role === "assistant")!;
    expect(final.status).toBe("stopped");
    expect(final.text).toContain("بداية");
    expect(final.text).toContain("x".repeat(600));
  }, 10000);
});
