/**
 * [T4.1] وصف سلوكي (characterisation) لدالة persistTurn بعد استخراجها من ChatScreen:
 * بوابة «من يحقّ له الكتابة» (العملية حيّة، العرض حيّ، الرسالة قانونية، ظهور التحذير، قبول النداء)
 * ومسار إعادة بناء محاولة المصدر (المحفوظة والقديمة). وحدة بلا تركيب React.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { persistTurn, type PersistTurnDeps } from "./persistTurn";
import { useSessionsStore } from "@/state/sessionsStore";
import { sessionOperationCoordinator } from "@/lib/chat/operationCoordinator";
import { KeyedError } from "@/lib/errors/keyedError";
import { uiText } from "@/i18n";
import type { SendArgs, SendCallbacks } from "@/lib/chat/chatController";
import type { ChatMessage, SessionMeta, TargetConfig, Turn, TurnAttempt, TurnRecord } from "@/types";

const captured = vi.hoisted(() => ({
  send: null as null | { args: SendArgs; cb: SendCallbacks; resolve: () => void },
}));

const db = vi.hoisted(() => ({
  claim: vi.fn(async (_sessionId: string, _operationId: string, _turnId: string, _canCreate: () => boolean) => 7),
  release: vi.fn(async () => undefined),
  updateIfOperation: vi.fn(async () => true),
  getTurn: vi.fn(async () => undefined as TurnRecord | undefined),
  persistAttempt: vi.fn(async (...args: unknown[]) => ({ ...(args[2] as TurnAttempt), attempt: 1 }) as TurnAttempt),
}));

vi.mock("@/lib/chat/chatController", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat/chatController")>();
  return {
    ...actual,
    sendTurn: (args: SendArgs, cb: SendCallbacks) =>
      new Promise<ChatMessage[]>((resolve) => {
        captured.send = { args, cb, resolve: () => resolve([]) };
      }),
  };
});

vi.mock("@/lib/db/repos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/repos")>();
  return {
    ...actual,
    claimOperationLease: db.claim,
    releaseOperationLease: db.release,
    updateSessionIfOperation: db.updateIfOperation,
    getTurn: db.getTurn,
    persistTurnAttempt: db.persistAttempt,
  };
});

const TARGETS: TargetConfig[] = [{ targetId: "t1", providerId: "openrouter", modelId: "openai/gpt-4o", modelInfo: { id: "openai/gpt-4o", label: "GPT-4o" } }];
const TURN: Turn = { id: "tr-1", sharedPrompt: "س1", customs: {} };

let n = 0;
function session(): SessionMeta {
  n += 1;
  return { id: "pt" + n, title: "جلسة", createdAt: 1, updatedAt: 1, modelIds: [], primaryTarget: null, layoutMode: "vertical", onDisk: false, onDiskDir: "folder-" + n };
}

function seedStore(s: SessionMeta, messages: ChatMessage[] = []): void {
  useSessionsStore.setState({ sessions: [s], currentId: s.id, messages, loading: false });
}

function depsFor(s: SessionMeta, over: Partial<PersistTurnDeps> = {}): PersistTurnDeps {
  return {
    session: s,
    sessionId: s.id,
    t: uiText.t,
    plural: uiText.plural,
    targets: TARGETS,
    syncMode: true,
    providerKeys: { openrouter: "k" },
    timeoutMs: 5000,
    contextMode: "stateful",
    multiStepTools: false,
    upsertMessagesLocal: vi.fn(),
    setToolErrors: vi.fn(),
    setToolActivity: vi.fn(),
    aborts: { current: new Map<string, AbortController>() },
    stopped: { current: new Set<string>() },
    viewGenerationRef: { current: 1 },
    ...over,
  };
}

function canonical(s: SessionMeta, turnId: string, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1", sessionId: s.id, turnId, createdAt: 2, role: "assistant", kind: "result", text: "أ",
    providerId: "openrouter", modelId: "openai/gpt-4o", modelInfo: { id: "openai/gpt-4o", label: "GPT-4o" },
    targetId: "t1", status: "streaming", ...over,
  };
}

function requireId(value: string | undefined): string {
  if (value === undefined) throw new Error("missing callback identity in the fixture");
  return value;
}

async function startedCall(): Promise<{ args: SendArgs; cb: SendCallbacks }> {
  await waitFor(() => expect(captured.send).not.toBeNull());
  const call = captured.send!;
  return { args: call.args, cb: call.cb };
}

beforeEach(() => {
  captured.send = null;
  db.claim.mockReset(); db.claim.mockResolvedValue(7);
  db.release.mockReset(); db.release.mockResolvedValue(undefined);
  db.updateIfOperation.mockReset(); db.updateIfOperation.mockResolvedValue(true);
  db.getTurn.mockReset(); db.getTurn.mockResolvedValue(undefined);
  db.persistAttempt.mockReset();
  db.persistAttempt.mockImplementation(async (...args: unknown[]) => ({ ...(args[2] as TurnAttempt), attempt: 1 }));
  useSessionsStore.setState({ sessions: [], currentId: null, messages: [], loading: false });
});

afterEach(async () => {
  captured.send?.resolve();
  for (const s of useSessionsStore.getState().sessions) sessionOperationCoordinator.cancel(s.id);
  await sessionOperationCoordinator.waitForIdle();
  captured.send = null;
});

describe("persistTurn - البوابة والعقد", () => {
  it("ينال عقد الإيجار والجيل ثم يرسل بمعرّفات صريحة فقط", async () => {
    const s = session();
    seedStore(s);
    const pending = persistTurn(depsFor(s), TURN, undefined, undefined, { t1: "m1" });
    const { args } = await startedCall();
    expect(db.claim).toHaveBeenCalledTimes(1);
    expect(db.claim.mock.calls[0][0]).toBe(s.id);
    expect(db.claim.mock.calls[0][2]).toBe("tr-1");
    expect(typeof db.claim.mock.calls[0][3]).toBe("function");
    expect(args.session.id).toBe(s.id);
    expect(args.kind).toBe("send");
    expect(args.syncMode).toBe(true);
    expect(args.contextMode).toBe("stateful");
    expect(args.operationGeneration).toBe(7);
    expect(args.attempt).toBeUndefined();
    expect(args.assistantIds).toEqual({ t1: "m1" });
    expect(args.assistantCreatedAts).toBeUndefined();
    expect(String(args.attemptId).startsWith("at")).toBe(true);
    expect(args.targets).toEqual([{ targetId: "t1", providerId: "openrouter", modelId: "openai/gpt-4o" }]);
    captured.send!.resolve();
    await pending;
    expect(db.release).toHaveBeenCalledWith(s.id, args.operationId, "finished");
    expect(sessionOperationCoordinator.isActive(s.id)).toBe(false);
  });

  it("العملية الملغاة لا تقبل أي نداء لاحق ولا تكتب شيئًا", async () => {
    const s = session();
    const deps = depsFor(s);
    seedStore(s);
    const pending = persistTurn(deps, TURN, undefined, undefined, { t1: "m1" });
    const { args, cb } = await startedCall();
    const attemptId = requireId(args.attemptId);
    seedStore(s, [canonical(s, "tr-1", { id: "m1", operationId: args.operationId, attemptId, attempt: 1 })]);
    sessionOperationCoordinator.cancel(s.id);
    cb.onDelta(args.operationId, "t1", "همس", attemptId, "tr-1", "m1");
    cb.onStatus(args.operationId, "t1", "error", "401", attemptId, "tr-1", "m1");
    cb.onAppended?.(canonical(s, "tr-1", { id: "m1", operationId: args.operationId, attemptId, attempt: 1, text: "متأخر" }));
    expect(sessionOperationCoordinator.progressFor(s.id)).toHaveLength(0);
    expect(deps.upsertMessagesLocal).not.toHaveBeenCalled();
    expect(useSessionsStore.getState().messages[0].text).toBe("أ");
    captured.send!.resolve();
    await pending;
    expect(db.release).toHaveBeenCalledWith(s.id, args.operationId, "cancelled");
  });

  it("العرض غير الحي: تُنشر الحالة للمنسّق دون كتابة محلية", async () => {
    const s = session();
    const other = session();
    seedStore(s);
    const deps = depsFor(s);
    const pending = persistTurn(deps, TURN, undefined, undefined, { t1: "m1" });
    const { args, cb } = await startedCall();
    const attemptId = requireId(args.attemptId);
    seedStore(s, [canonical(s, "tr-1", { id: "m1", operationId: args.operationId, attemptId, attempt: 1 })]);
    // جلسة أخرى معروضة: الحالة تصل المنسّق ولا تصل المخزن المحلي.
    useSessionsStore.setState({ currentId: other.id });
    cb.onDelta(args.operationId, "t1", "x", attemptId, "tr-1", "m1");
    expect(sessionOperationCoordinator.progressFor(s.id)).toHaveLength(1);
    expect(sessionOperationCoordinator.progressFor(s.id)[0].text).toBe("أx");
    expect(deps.upsertMessagesLocal).not.toHaveBeenCalled();
    // جيل عرض أقدم: القيد نفسه.
    useSessionsStore.setState({ currentId: s.id });
    deps.viewGenerationRef.current += 1;
    cb.onDelta(args.operationId, "t1", "y", attemptId, "tr-1", "m1");
    expect(deps.upsertMessagesLocal).not.toHaveBeenCalled();
    // ثم العرض الحي يكتب فعلًا.
    deps.viewGenerationRef.current -= 1;
    cb.onDelta(args.operationId, "t1", "z", attemptId, "tr-1", "m1");
    expect(deps.upsertMessagesLocal).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.upsertMessagesLocal).mock.calls[0][0][0].text).toBe("أz");
    captured.send!.resolve();
    await pending;
  });

  it("الرسالة غير القانونية تُرفض: كل هوية يجب أن تطابق", async () => {
    const s = session();
    seedStore(s);
    const deps = depsFor(s);
    const pending = persistTurn(deps, TURN, undefined, undefined, { t1: "m1" });
    const { args, cb } = await startedCall();
    const attemptId = requireId(args.attemptId);
    const op = args.operationId;
    seedStore(s, [canonical(s, "tr-1", { id: "m1", operationId: op, attemptId, attempt: 1 })]);
    cb.onDelta(op, "t1", "a", "at-wrong", "tr-1", "m1");
    cb.onDelta(op, "t1", "b", attemptId, "tr-other", "m1");
    cb.onDelta(op, "t1", "c", attemptId, "tr-1", "m-other");
    cb.onDelta("op-other", "t1", "d", attemptId, "tr-1", "m1");
    cb.onDelta(op, "wrong-target", "e", attemptId, "tr-1", "m1");
    expect(sessionOperationCoordinator.progressFor(s.id)).toHaveLength(0);
    expect(useSessionsStore.getState().messages[0].text).toBe("أ");
    cb.onDelta(op, "t1", "f", attemptId, "tr-1", "m1");
    expect(sessionOperationCoordinator.progressFor(s.id)).toHaveLength(1);
    expect(sessionOperationCoordinator.progressFor(s.id)[0].text).toBe("أf");
    captured.send!.resolve();
    await pending;
  });

  it("onAppended يمرّر سؤال المستخدم للعرض وحده ولا ينشر صفًا غير قانوني", async () => {
    const s = session();
    seedStore(s);
    const deps = depsFor(s);
    const pending = persistTurn(deps, TURN, undefined, undefined, { t1: "m1" });
    const { args, cb } = await startedCall();
    const prompt: ChatMessage = { id: "p1", sessionId: s.id, turnId: "tr-1", createdAt: 1, role: "user", kind: "prompt", text: "س1", promptKind: "shared", status: "done", operationId: args.operationId, attemptId: args.attemptId, attempt: 1 };
    cb.onAppended?.(prompt);
    expect(deps.upsertMessagesLocal).toHaveBeenCalledWith([prompt], { canPublish: expect.any(Function) });
    expect(sessionOperationCoordinator.progressFor(s.id)).toHaveLength(0);
    // صف مساعد بلا هوية العملية الحالية: لا نشر ولا تمرير (الفرعان مختلفان).
    const stray = canonical(s, "tr-1", { id: "m1", operationId: "op-other", attemptId: args.attemptId, attempt: 1 });
    cb.onAppended?.(stray);
    expect(sessionOperationCoordinator.progressFor(s.id)).toHaveLength(0);
    expect(deps.upsertMessagesLocal).toHaveBeenCalledTimes(1);
    captured.send!.resolve();
    await pending;
  });

  it("التحذير يظهر لآخر عملية وفي العرض الحي فقط", async () => {
    const s = session();
    seedStore(s);
    const warn = vi.spyOn(toast, "warning").mockImplementation(() => "");
    try {
      const pending = persistTurn(depsFor(s), TURN);
      const { args, cb } = await startedCall();
      cb.onWarning?.("تحذير-1");
      expect(warn).toHaveBeenCalledWith("تحذير-1");
      warn.mockClear();
      useSessionsStore.setState({ currentId: "other" });
      cb.onWarning?.("تحذير-2");
      expect(warn).not.toHaveBeenCalled();
      useSessionsStore.setState({ currentId: s.id });
      sessionOperationCoordinator.finish(args.operationId, s.id);
      const newer = sessionOperationCoordinator.start(s.id, "send", new AbortController());
      cb.onWarning?.("تحذير-3");
      expect(warn).not.toHaveBeenCalled();
      if (newer) sessionOperationCoordinator.finish(newer.id, s.id);
      captured.send!.resolve();
      await pending;
    } finally {
      warn.mockRestore();
    }
  });

  it("onStatus بخطأ: العرض الحي يرى النص المترجَم من الخريطة المخزَّنة", async () => {
    const s = session();
    seedStore(s);
    const err = vi.spyOn(toast, "error").mockImplementation(() => "");
    try {
      const pending = persistTurn(depsFor(s), TURN, undefined, undefined, { t1: "m1" });
      const { args, cb } = await startedCall();
      const attemptId = requireId(args.attemptId);
      seedStore(s, [canonical(s, "tr-1", { id: "m1", operationId: args.operationId, attemptId, attempt: 1 })]);
      cb.onStatus(args.operationId, "t1", "error", "401", attemptId, "tr-1", "m1");
      expect(err).toHaveBeenCalledWith("401");
      err.mockClear();
      // القيمة المخزَّنة المعروفة تُترجَم عند الحدّ (D6) لا تُعرض كما هي.
      cb.onStatus(args.operationId, "t1", "error", "توقفت العملية قبل اكتمالها", attemptId, "tr-1", "m1");
      expect(err).toHaveBeenCalledWith(uiText.t("errors.interruptedTurn"));
      err.mockClear();
      cb.onStatus(args.operationId, "t1", "error", "401", "at-wrong", "tr-1", "m1");
      expect(err).not.toHaveBeenCalled();
      captured.send!.resolve();
      await pending;
    } finally {
      err.mockRestore();
    }
  });

  it("خطأ مُفتَّح في مسار الإرسال يُترجَم عند الحدّ ولا يتسرب المفتاح", async () => {
    const s = session();
    seedStore(s);
    db.claim.mockRejectedValueOnce(new KeyedError("errors.noValidTargets"));
    const err = vi.spyOn(toast, "error").mockImplementation(() => "");
    try {
      await persistTurn(depsFor(s), TURN);
      expect(err).toHaveBeenCalledWith(uiText.t("errors.noValidTargets"));
      expect(err).not.toHaveBeenCalledWith("errors.noValidTargets");
    } finally {
      err.mockRestore();
    }
  });
});

describe("persistTurn - إعادة بناء محاولة المصدر", () => {
  const turnId = "tr-retry";
  function attempt(): TurnAttempt {
    return {
      id: "at-old", turnId, attempt: 2, kind: "send", createdAt: 1, status: "error", operationId: "op-old",
      targets: [{
        targetId: "t1", providerId: "openrouter", modelId: "openai/gpt-4o", modelInfo: { id: "openai/gpt-4o", label: "GPT-4o" },
        sharedPrompt: "س1", customPrompt: null, promptText: "س1", hasShared: true, hasCustom: false,
      }],
    };
  }
  function result(): ChatMessage {
    return {
      id: "r-old", sessionId: "pt-retry", turnId, createdAt: 2, role: "assistant", kind: "result", text: "رد",
      providerId: "openrouter", modelId: "openai/gpt-4o", modelInfo: { id: "openai/gpt-4o", label: "GPT-4o" },
      targetId: "t1", status: "error", operationId: "op-old", attemptId: "at-old", attempt: 2,
    };
  }
  function retrySession(): SessionMeta {
    const s = session();
    return s;
  }

  it("محاولة محفوظة: مصدر ثابت وتمريرة بلا سؤال موحد", async () => {
    const s = retrySession();
    const row = { ...result(), sessionId: s.id };
    const record: TurnRecord = { id: turnId, sessionId: s.id, createdAt: 1, status: "error", contextMode: "stateful", sharedPrompt: "س1", attempts: [attempt()] };
    db.getTurn.mockResolvedValueOnce(record);
    seedStore(s, [row]);
    const pending = persistTurn(depsFor(s), { id: turnId, sharedPrompt: null, customs: {} }, "t1", [row], { t1: row.id });
    const { args } = await startedCall();
    expect(args.kind).toBe("retry");
    expect(args.syncMode).toBe(false);
    expect(args.turn).toEqual({ id: turnId, sharedPrompt: null, customs: {} });
    expect(args.targets).toEqual([{ targetId: "t1", providerId: "openrouter", modelId: "openai/gpt-4o" }]);
    expect(args.attempt?.id).toBe("at-old");
    expect(args.attempt?.targets[0]).toMatchObject({ targetId: "t1", promptText: "س1", hasShared: true, hasCustom: false });
    expect(args.assistantCreatedAts).toEqual({ t1: row.createdAt });
    expect(db.persistAttempt).not.toHaveBeenCalled();
    captured.send!.resolve();
    await pending;
  });

  it("بلا سجل: تُبنى المحاولة القديمة وتُحفظ قبل الإرسال ثم يتعلّم الرقم من onAppended", async () => {
    const s = retrySession();
    const row = { ...result(), sessionId: s.id };
    seedStore(s, [
      { id: "p1", sessionId: s.id, turnId, createdAt: 1, role: "user", kind: "prompt", text: "س1", promptKind: "shared", status: "done" },
      { id: "p2", sessionId: s.id, turnId, createdAt: 1, role: "user", kind: "prompt", text: "زد", promptKind: "custom", targetId: "t1", status: "done" },
      row,
    ]);
    const deps = depsFor(s);
    const pending = persistTurn(deps, { id: turnId, sharedPrompt: null, customs: {} }, "t1", [row], { t1: "m-new" });
    const { args, cb } = await startedCall();
    expect(db.persistAttempt).toHaveBeenCalledTimes(1);
    const legacy = db.persistAttempt.mock.calls[0][2] as TurnAttempt;
    expect(legacy.id).toBe("legacy-" + turnId);
    expect(legacy.attempt).toBe(0);
    expect(legacy.sourceMessageId).toBe(row.id);
    expect(legacy.targets[0].promptText).toBe("س1" + uiText.t("chat.customInstructionsMarker") + "زد");
    expect(legacy.targets[0]).toMatchObject({ hasShared: true, hasCustom: true });
    expect(db.persistAttempt.mock.calls[0][1]).toBe(turnId);
    expect(db.persistAttempt.mock.calls[0][4]).toBe("س1");
    expect(args.attempt?.attempt).toBe(1);
    // Rehearsal for a retry: currentAttemptNumber is still undefined until the first canonical row.
    const learned = canonical(s, turnId, { id: "m-new", text: "محاولة-5", operationId: args.operationId, attemptId: args.attemptId, attempt: 5 });
    cb.onAppended?.(learned);
    expect(sessionOperationCoordinator.progressFor(s.id)).toHaveLength(1);
    cb.onAppended?.(canonical(s, turnId, { id: "m-new", text: "محاولة-4", operationId: args.operationId, attemptId: args.attemptId, attempt: 4 }));
    expect(sessionOperationCoordinator.progressFor(s.id)).toHaveLength(1);
    expect(sessionOperationCoordinator.progressFor(s.id)[0].text).toBe("محاولة-5");
    captured.send!.resolve();
    await pending;
  });

  it("سجل بلا محاولة مطابقة: لا إرسال ويُعرض نص الخطأ", async () => {
    const s = retrySession();
    const row = { ...result(), sessionId: s.id };
    const record: TurnRecord = { id: turnId, sessionId: s.id, createdAt: 1, status: "error", contextMode: "stateful", sharedPrompt: "س1", attempts: [] };
    db.getTurn.mockResolvedValueOnce(record);
    seedStore(s, [row]);
    const err = vi.spyOn(toast, "error").mockImplementation(() => "");
    try {
      await persistTurn(depsFor(s), { id: turnId, sharedPrompt: null, customs: {} }, "t1", [row], { t1: row.id });
      expect(captured.send).toBeNull();
      expect(err).toHaveBeenCalledWith("المحاولة المحفوظة غير صالحة لإعادة المحاولة");
    } finally {
      err.mockRestore();
    }
  });
});
