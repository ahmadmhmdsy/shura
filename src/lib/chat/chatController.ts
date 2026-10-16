import { uiText } from "@/i18n";
import { appendMessage, claimOperationLease, getTurn, persistTurnAttempt, recordUsage, releaseOperationLease, supersedeTurnAttempts, updateSessionIfOperation, updateTurnAttemptStatus } from "@/lib/db/repos";
import { newId } from "@/lib/id";
import { buildTurnTargets } from "./turnBuilder";
import { KeyedError, errorText } from "@/lib/errors/keyedError";
import { dispatchTurn } from "./dispatch";
import { getFileSink, isFilePersistActive } from "@/lib/markdown/sink";
import { appendTurn, writeSessionMeta } from "@/lib/markdown/writer";
import { isTerminal } from "@/lib/db/repos/identity";
import type { BuiltPrompt, ChatMessage, ContextMode, ModelInfo, ProviderId, SessionMeta, TargetSnapshot, Turn, TurnAttempt, TurnStatus } from "@/types";

export interface SendCallbacks {
  onDelta(operationId: string, targetId: string, chunk: string, attemptId: string, turnId?: string, messageId?: string): void;
  /** [T2.7/LV-02] حالة التفكير الحيّة؛ اختيارية كي لا تُلزم المستدعين الذين لا يعرضونها. */
  onReasoning?(operationId: string, targetId: string, active: boolean, attemptId: string, turnId?: string, messageId?: string): void;
  onStatus(operationId: string, targetId: string, status: ChatMessage["status"], error: string | undefined, attemptId: string, turnId?: string, messageId?: string): void;
  onDropped(operationId: string, targetIds: string[], attemptId: string, turnId?: string): void;
  onWarning?(message: string): void;
  onAppended?(msg: ChatMessage): void;
  onToolExecutionStart?(targetId: string, toolName: string): void;
  onToolExecutionEnd?(targetId: string, toolName: string): void;
  onToolExecutionError?(targetId: string, toolName: string, error: string): void;
}

function observe(observer: (() => unknown) | undefined): void {
  if (!observer) return;
  try {
    const result = observer();
    if (result && typeof (result as PromiseLike<unknown>).then === "function") {
      void Promise.resolve(result).catch(() => { /* rejected live observer is non-fatal */ });
    }
  } catch { /* synchronous live observer failure is non-fatal */ }
}

export interface SendArgs {
  session: SessionMeta;
  turn: Turn;
  targets: { targetId: string; providerId: ProviderId; modelId: string }[];
  syncMode: boolean;
  apiKeyFor(providerId: ProviderId): string;
  sessionHeaderFor(providerId: ProviderId): Record<string, string> | undefined;
  externalSignalFor(targetId: string): AbortSignal;
  timeoutMs: number;
  /** Reuse the result id when retrying so the UI replaces rather than duplicates a card. */
  assistantIds?: Record<string, string>;
  /** Preserve createdAt for a reused result id; it is an immutable message coordinate. */
  assistantCreatedAts?: Record<string, number>;
  /** A persisted attempt is the immutable source for a retry; composer drafts are ignored. */
  attempt?: TurnAttempt;
  /** Override identities for callers/tests; normal sends generate both values. */
  attemptId?: string;
  attemptNumber?: number;
  kind?: TurnAttempt["kind"];
  operationId: string;
  /** Captured operation signal; it remains stable after coordinator release. */
  operationSignal: AbortSignal;
  /** Exact coordinator/tombstone ownership check used at every await boundary. */
  operationIsCurrent?: () => boolean;
  /** Durable lease generation claimed by the UI boundary; direct callers claim their own. */
  operationGeneration?: number;
  contextMode: ContextMode;
  multiStepTools: boolean;
  historyFor(targetId: string): readonly ChatMessage[];
  modelInfoFor(targetId: string): ModelInfo;
}

function cloneModelInfo(info: ModelInfo): ModelInfo {
  return { ...info, pricing: info.pricing ? { ...info.pricing } : info.pricing };
}

function cloneTarget(target: TargetSnapshot): TargetSnapshot {
  return { ...target, modelInfo: cloneModelInfo(target.modelInfo) };
}

function cloneSnapshots(targets: readonly TargetSnapshot[]): TargetSnapshot[] {
  return targets.map(cloneTarget);
}

function userMsg(
  sessionId: string,
  turnId: string,
  operationId: string,
  text: string,
  promptKind: "shared" | "custom",
  targetId?: string,
  attemptId?: string,
  attempt?: number,
): ChatMessage {
  return {
    id: newId("m"),
    sessionId,
    turnId,
    createdAt: Date.now(),
    role: "user",
    kind: "prompt",
    text,
    promptKind,
    targetId,
    status: "done",
    operationId,
    attemptId,
    attempt,
  };
}

function promptsFromAttempt(attempt: TurnAttempt): BuiltPrompt[] {
  return attempt.targets.map((target) => ({
    targetId: target.targetId,
    providerId: target.providerId,
    modelId: target.modelId,
    text: target.promptText,
    hasShared: target.hasShared,
    hasCustom: target.hasCustom,
  }));
}

function turnFromAttempt(attempt: TurnAttempt): Turn {
  const shared = attempt.targets.find((target) => target.hasShared)?.sharedPrompt ?? null;
  const customs = Object.fromEntries(
    attempt.targets.filter((target) => target.hasCustom).map((target) => [target.targetId, target.customPrompt ?? ""]),
  );
  return { id: attempt.turnId, sharedPrompt: shared, customs };
}

function snapshotForPrompt(
  prompt: BuiltPrompt,
  _target: { targetId: string; providerId: ProviderId; modelId: string } | undefined,
  turn: Turn,
  modelInfoFor: (targetId: string) => ModelInfo,
): TargetSnapshot {
  const custom = turn.customs[prompt.targetId]?.trim() || null;
  return {
    targetId: prompt.targetId,
    providerId: prompt.providerId,
    modelId: prompt.modelId,
    modelInfo: cloneModelInfo(modelInfoFor(prompt.targetId)),
    sharedPrompt: turn.sharedPrompt?.trim() || null,
    customPrompt: custom,
    promptText: prompt.text,
    hasShared: prompt.hasShared,
    hasCustom: prompt.hasCustom,
  };
}

function statusForOutcomes(outcomes: readonly { status: TurnStatus }[]): TurnStatus {
  if (outcomes.some((outcome) => outcome.status === "error")) return "error";
  // [NM-02] بث مقطوع ليس نجاحًا: نتيجة واحدة مقطوعة تمنع وسم الدور done.
  if (outcomes.some((outcome) => outcome.status === "truncated")) return "truncated";
  if (outcomes.length > 0 && outcomes.every((outcome) => outcome.status === "stopped")) return "stopped";
  return "done";
}

/**
 * Persist first, then run the provider. A retry receives an immutable persisted attempt and
 * therefore cannot be changed by the current composer draft or a later mutable config object.
 */
export async function sendTurn(args: SendArgs, cb: SendCallbacks): Promise<ChatMessage[]> {
  const { session, turn } = args;
  const sourceAttempt = args.attempt;
  const opId = args.operationId;
  const attemptId = args.attemptId ?? newId("at");
  const operationSignal = args.operationSignal;
  const ownershipCurrent = (): boolean => args.operationIsCurrent?.() ?? true;
  const isOwned = (): boolean => !operationSignal.aborted && ownershipCurrent();
  class Cancelled extends Error {}
  const assertOwned = (): void => {
    if (!isOwned()) throw new Cancelled();
  };
  const isCancellation = (error: unknown): boolean => error instanceof Cancelled || !isOwned();
  let leaseGeneration = args.operationGeneration;
  const ownsLease = leaseGeneration === undefined;

  const built = sourceAttempt
    ? { prompts: promptsFromAttempt(sourceAttempt), dropped: [] as string[] }
    : buildTurnTargets(turn, args.targets, args.syncMode);
  if (built.prompts.length === 0) throw new KeyedError("errors.noValidTargets");
  const archiveTurn = sourceAttempt ? turnFromAttempt(sourceAttempt) : turn;
  const targets: TargetSnapshot[] = sourceAttempt
    ? cloneSnapshots(sourceAttempt.targets)
    : built.prompts.map((prompt) => snapshotForPrompt(
      prompt,
      args.targets.find((target) => target.targetId === prompt.targetId),
      turn,
      args.modelInfoFor,
    ));
  const history = new Map<string, readonly ChatMessage[]>();
  for (const prompt of built.prompts) {
    history.set(prompt.targetId, args.historyFor(prompt.targetId).map((message) => ({ ...message })));
  }

  type BoundSignal = { signal: AbortSignal; cleanup: () => void };
  type StreamState = { accum: string; persistedLen: number; timer: ReturnType<typeof setInterval>; queue: Promise<unknown> };
  const boundSignals = new Map<string, BoundSignal>();
  const signalFor = (targetId: string): AbortSignal => {
    const existing = boundSignals.get(targetId);
    if (existing) return existing.signal;
    const controller = new AbortController();
    const cleanups: (() => void)[] = [];
    const bind = (source: AbortSignal | undefined): void => {
      if (!source || source === controller.signal) return;
      const abort = (): void => {
        if (!controller.signal.aborted) controller.abort(source.reason ?? new Error("أُلغي العملية"));
      };
      if (source.aborted) abort();
      else {
        source.addEventListener("abort", abort, { once: true });
        cleanups.push(() => source.removeEventListener("abort", abort));
      }
    };
    bind(operationSignal);
    const external = args.externalSignalFor(targetId);
    // Skip the second bind when the external signal IS the operation signal, or the
    // same abort would be wired twice.
    if (external !== operationSignal) bind(external);
    const entry: BoundSignal = {
      signal: controller.signal,
      cleanup: () => {
        for (const cleanup of cleanups) cleanup();
        cleanups.length = 0;
      },
    };
    boundSignals.set(targetId, entry);
    return entry.signal;
  };
  const signalsLive = (): boolean => {
    if (!isOwned()) return false;
    for (const bound of boundSignals.values()) if (bound.signal.aborted) return false;
    return true;
  };
  const assertSignalsLive = (): void => {
    if (!signalsLive()) throw new Cancelled();
  };

  const durableRows = new Map<string, ChatMessage>();
  const assistantRows: ChatMessage[] = [];
  let canonicalAttempt: TurnAttempt | undefined;
  let stopStreams: (() => Promise<void>) | undefined;
  const emit = async (message: ChatMessage): Promise<boolean> => {
    const result = await appendMessage(message);
    if (!result.accepted) return false;
    const stored = result.current ?? message;
    durableRows.set(stored.id, stored);
    if (isOwned()) observe(() => cb.onAppended?.(stored));
    return true;
  };
  const emitTerminal = async (message: ChatMessage): Promise<boolean> => {
    for (let retry = 0; retry < 2; retry += 1) {
      const accepted = await emit(message).catch(() => false);
      if (accepted) return true;
    }
    return false;
  };
  const updateAttemptStatus = async (status: TurnStatus): Promise<boolean> => {
    if (!canonicalAttempt) return false;
    for (let retry = 0; retry < 2; retry += 1) {
      const updated = await updateTurnAttemptStatus(turn.id, canonicalAttempt.id, status, canonicalAttempt.operationId).catch(() => false);
      if (updated) return true;
    }
    return false;
  };
  const warn = (message: string): void => {
    // The caller owns the latest-operation/tombstone filter. Emit even after
    // local ownership is released so a canceled operation can still surface a
    // bounded finalization warning before a replacement starts.
    observe(() => cb.onWarning?.(message));
  };
  // Assigned when the stream states are built. A cancellation can read it because every
  // call site of finalizeCancelled runs after that point.
  let streamStates: Map<string, StreamState> | null = null;
  const finalizeCancelled = async (): Promise<ChatMessage[]> => {
    if (stopStreams) await stopStreams().catch(() => undefined);
    const terminalStatuses: TurnStatus[] = [];
    for (const row of durableRows.values()) {
      if (row.role !== "assistant" && row.kind !== "result" && row.kind !== "synthesis") continue;
      if (isTerminal(row.status)) {
        // A terminal primary is immutable. If cancellation raced its final
        // append, preserve that exact terminal row and its status.
        terminalStatuses.push(row.status);
        continue;
      }
      // The checkpoint interval persists a streaming row at most every 250ms, so the tail
      // the user can see is not necessarily in the durable row yet. The accumulated buffer
      // is that tail: without it a Stop in the next quarter second deletes visible text.
      const accum = streamStates?.get(row.targetId ?? "")?.accum ?? "";
      const stopped: ChatMessage = { ...row, text: accum.length > row.text.length ? accum : row.text, status: "stopped" };
      const accepted = await appendMessage(stopped).then((result) => {
        if (result.accepted) {
          durableRows.set(stopped.id, result.current ?? stopped);
          if (isOwned()) observe(() => cb.onStatus(opId, stopped.targetId ?? "", "stopped", undefined, attemptId, turn.id, stopped.id));
        }
        return result.accepted;
      }).catch(() => false);
      terminalStatuses.push("stopped");
      if (!accepted) warn(uiText.t("chat.stoppedSaveFailed"));
    }
    if (canonicalAttempt) {
      const attemptStatus: TurnStatus = terminalStatuses.length === 0
        ? "stopped"
        : terminalStatuses.includes("error")
          ? "error"
          : terminalStatuses.includes("truncated")
            ? "truncated"
            : terminalStatuses.every((status) => status === "stopped")
              ? "stopped"
              : "done";
      // A terminal primary row is durable even when the attempt record cannot be
      // updated. Report the inconsistency instead of silently leaving the attempt
      // looking live until a later startup reconciliation repairs it.
      const attemptUpdated = await updateAttemptStatus(attemptStatus);
      if (!attemptUpdated) warn(uiText.t("chat.attemptStatusAfterStopFailed"));
    }
    return [];
  };

  /**
   * R3-I3 recovery: the attempt is already durable, so an ordinary failure in the
   * prompt/placeholder/setup boundaries must still reach an explicit terminal state.
   * Streaming rows are closed as error, partial text is preserved, and the attempt is
   * updated; an unfixable attempt emits one bounded warning instead of looking live.
   */
  const finalizeSetupFailure = async (error: unknown): Promise<ChatMessage[]> => {
    if (stopStreams) await stopStreams().catch(() => undefined);
    const message = errorText(uiText.t, error);
    const finals: Record<string, ChatMessage> = {};
    let primaryFailed = false;
    for (const row of durableRows.values()) {
      if (row.role !== "assistant" && row.kind !== "result" && row.kind !== "synthesis") continue;
      if (isTerminal(row.status)) {
        finals[row.targetId ?? ""] = row;
        continue;
      }
      const failed: ChatMessage = { ...row, status: "error", error: message };
      const accepted = await emitTerminal(failed);
      if (!accepted) primaryFailed = true;
      else {
        finals[row.targetId ?? ""] = failed;
        if (isOwned()) observe(() => cb.onStatus(opId, row.targetId ?? "", "error", message, attemptId, turn.id, row.id));
      }
    }
    const attemptUpdated = await updateAttemptStatus("error");
    if (primaryFailed || !attemptUpdated) warn(uiText.t("chat.primaryOrAttemptPinFailed"));
    return Object.values(finals);
  };

  try {
    assertOwned();
    if (leaseGeneration === undefined) {
      leaseGeneration = await claimOperationLease(session.id, opId, turn.id, isOwned);
    }
    assertOwned();
    const existing = await getTurn(turn.id);
    assertOwned();
    const previousAttemptIds = (existing?.attempts ?? [])
      .filter((attempt) => attempt.id !== attemptId)
      .map((attempt) => attempt.id);
    const attemptToPersist: TurnAttempt = {
      id: attemptId,
      turnId: turn.id,
      // The repository assigns the monotonic number; a caller-supplied number is never trusted.
      attempt: 0,
      kind: args.kind ?? (sourceAttempt ? "retry" : "send"),
      createdAt: Date.now(),
      status: "streaming",
      operationId: opId,
      targets: cloneSnapshots(targets),
    };
    canonicalAttempt = await persistTurnAttempt(
      session.id,
      turn.id,
      attemptToPersist,
      args.contextMode,
      archiveTurn.sharedPrompt?.trim() || null,
      isOwned,
      leaseGeneration,
    );
    assertOwned();

    // Capture one stable signal per target before any await that can race cancellation.
    for (const prompt of built.prompts) signalFor(prompt.targetId);
    assertSignalsLive();

    if (built.dropped.length && isOwned()) observe(() => cb.onDropped(opId, built.dropped, attemptId, turn.id));
    const sink = getFileSink();
    const dir = session.onDiskDir ? "sessions/" + session.onDiskDir : null;
    if (archiveTurn.sharedPrompt?.trim()) {
      assertOwned();
      const accepted = await emit(userMsg(session.id, turn.id, opId, archiveTurn.sharedPrompt.trim(), "shared", undefined, canonicalAttempt.id, canonicalAttempt.attempt));
      if (!accepted) throw new KeyedError("errors.attemptPromptSaveFailed");
      assertOwned();
    }
    for (const prompt of built.prompts) {
      if (!prompt.hasCustom) continue;
      assertOwned();
      const accepted = await emit(userMsg(session.id, turn.id, opId, prompt.text, "custom", prompt.targetId, canonicalAttempt.id, canonicalAttempt.attempt));
      if (!accepted) throw new KeyedError("errors.attemptPromptSaveFailed");
      assertOwned();
    }

    const snapshotByTarget = new Map(targets.map((target) => [target.targetId, target]));
    assistantRows.push(...built.prompts.map((prompt) => {
      const assistantId = args.assistantIds?.[prompt.targetId];
      const capturedCreatedAt = history.get(prompt.targetId)?.find((row) => row.id === assistantId)?.createdAt;
      return {
        id: assistantId ?? newId("m"),
        sessionId: session.id,
        turnId: turn.id,
        createdAt: args.assistantCreatedAts?.[prompt.targetId] ?? capturedCreatedAt ?? Date.now(),
        role: "assistant" as const,
        kind: "result" as const,
        text: "",
        providerId: prompt.providerId,
        modelId: prompt.modelId,
        targetId: prompt.targetId,
        modelInfo: snapshotByTarget.get(prompt.targetId)?.modelInfo,
        status: "streaming" as const,
        operationId: opId,
        attemptId: canonicalAttempt!.id,
        attempt: canonicalAttempt!.attempt,
      };
    }));
    for (const message of assistantRows) {
      assertOwned();
      if (!(await emit(message))) throw new KeyedError("errors.streamCardSaveFailed");
      assertOwned();
    }

    if (dir && !(await sink.exists(dir + "/meta.json"))) {
      assertOwned();
      // The initial manifest is an archive sidecar: a failure must warn, never turn the
      // primary durable row into an error. appendTurn can still create the manifest.
      try {
        await writeSessionMeta(sink, dir, session);
      } catch {
        warn(uiText.t("chat.archiveMetaCreateFailed"));
      }
      assertOwned();
    }
    if (previousAttemptIds.length > 0 && isOwned()) {
      let superseded = false;
      for (let retry = 0; retry < 2 && !superseded; retry += 1) {
        try { superseded = await supersedeTurnAttempts(turn.id, previousAttemptIds); } catch { /* retry below */ }
        if (!isOwned()) break;
      }
      if (!superseded && isOwned()) warn(uiText.t("chat.previousAttemptUpdateFailed"));
    }

    const streams = new Map<string, StreamState>();
    streamStates = streams;
    const closingTargets = new Set<string>();
    const finalizedTargets = new Set<string>();
    const checkpointWrite = (targetId: string, text: string): void => {
      const state = streams.get(targetId);
      if (!state || closingTargets.has(targetId)) return;
      state.queue = state.queue.then(() => {
        // A queued checkpoint is a live-stream write. Once ownership is gone,
        // only finalize an already-persisted row; never create a new streaming write.
        if (!isOwned() || !signalsLive()) return undefined;
        const message = assistantRows.find((candidate) => candidate.targetId === targetId);
        if (!message) return undefined;
        return appendMessage({ ...message, text, status: "streaming" }).then((result) => {
          if (result.accepted) {
            const stored = result.current ?? { ...message, text, status: "streaming" as const };
            durableRows.set(stored.id, stored);
          }
          return result.accepted ? undefined : false;
        });
      }).catch(() => false);
    };
    const noteChunk = (callbackOperationId: string, targetId: string, chunk: string, callbackAttemptId: string): void => {
      if (callbackOperationId !== opId || callbackAttemptId !== canonicalAttempt!.id || !signalsLive()) return;
      const state = streams.get(targetId);
      if (!state || closingTargets.has(targetId)) return;
      state.accum += chunk;
      if (state.accum.length - state.persistedLen >= 512) {
        state.persistedLen = state.accum.length;
        checkpointWrite(targetId, state.accum);
      }
    };
    for (const prompt of built.prompts) {
      if (streams.has(prompt.targetId)) continue;
      const timer = setInterval(() => {
        const state = streams.get(prompt.targetId);
        if (!state || closingTargets.has(prompt.targetId)) return;
        if (state.accum.length > state.persistedLen) {
          state.persistedLen = state.accum.length;
          checkpointWrite(prompt.targetId, state.accum);
        }
      }, 250);
      streams.set(prompt.targetId, { accum: "", persistedLen: 0, timer, queue: Promise.resolve() });
    }
    const closeTarget = (targetId: string): void => {
      const state = streams.get(targetId);
      if (!state) return;
      clearInterval(state.timer);
      closingTargets.add(targetId);
    };
    const closeAllTargets = (): void => {
      for (const targetId of streams.keys()) closeTarget(targetId);
    };
    const settleTarget = async (targetId: string): Promise<void> => {
      const state = streams.get(targetId);
      if (!state) return;
      closeTarget(targetId);
      await state.queue;
      finalizedTargets.add(targetId);
    };
    const drainStreams = async (): Promise<void> => {
      closeAllTargets();
      for (const targetId of streams.keys()) {
        if (!finalizedTargets.has(targetId)) await settleTarget(targetId).catch(() => undefined);
      }
    };
    stopStreams = drainStreams;

    let outcomes: Awaited<ReturnType<typeof dispatchTurn>>;
    try {
      // No await is allowed between this ownership check and the frozen dispatch call.
      assertSignalsLive();
      outcomes = await dispatchTurn({
        operationId: opId,
        sessionId: session.id,
        turnId: turn.id,
        prompts: built.prompts,
        apiKeyFor: args.apiKeyFor,
        sessionHeaderFor: args.sessionHeaderFor,
        timeoutMs: args.timeoutMs,
        externalSignalFor: (targetId) => signalFor(targetId),
        contextMode: args.contextMode,
        historyFor: (targetId) => history.get(targetId) ?? [],
        modelInfoFor: (targetId) => snapshotByTarget.get(targetId)?.modelInfo ?? args.modelInfoFor(targetId),
        multiStepTools: args.multiStepTools,
        onToolExecutionStart: cb.onToolExecutionStart,
        onToolExecutionEnd: cb.onToolExecutionEnd,
        onToolExecutionError: cb.onToolExecutionError,
        onUpdate: (callbackOperationId, targetId, chunk) => {
          if (callbackOperationId !== opId || !signalsLive() || closingTargets.has(targetId) || !streams.has(targetId)) return;
          noteChunk(callbackOperationId, targetId, chunk, canonicalAttempt!.id);
          const message = assistantRows.find((candidate) => candidate.targetId === targetId);
          if (isOwned() && message) observe(() => cb.onDelta(callbackOperationId, targetId, chunk, canonicalAttempt!.id, turn.id, message.id));
        },
        onReasoning: (callbackOperationId, targetId, active) => {
          // لا نقطة حفظ ولا تراكم نص: الحالة تُنشر فورًا لأن نافذة «يفكّر» قد لا يصحبها أي نص بعد.
          if (callbackOperationId !== opId || !signalsLive() || closingTargets.has(targetId) || !streams.has(targetId)) return;
          const message = assistantRows.find((candidate) => candidate.targetId === targetId);
          if (isOwned() && message) observe(() => cb.onReasoning?.(callbackOperationId, targetId, active, canonicalAttempt!.id, turn.id, message.id));
        },
      });
    } catch (dispatchErr) {
      if (isCancellation(dispatchErr)) return finalizeCancelled();
      closeAllTargets();
      const message = dispatchErr instanceof Error ? dispatchErr.message : String(dispatchErr);
      const fallback: Record<string, ChatMessage> = {};
      await Promise.all(assistantRows.map(async (row) => {
        const targetId = row.targetId;
        if (!targetId || !isOwned()) return;
        await settleTarget(targetId).catch(() => undefined);
        if (!isOwned()) return;
        const text = streams.get(targetId)?.accum ?? "";
        const final: ChatMessage = { ...row, text, status: "error", error: message };
        const accepted = await emitTerminal(final);
        if (!accepted) warn(uiText.t("chat.primarySaveAfterDispatchErrorFailed"));
        if (accepted || durableRows.get(row.id)?.status === "error") {
          fallback[targetId] = final;
          const callbackRow = assistantRows.find((candidate) => candidate.targetId === targetId);
          if (isOwned() && callbackRow) observe(() => cb.onStatus(opId, targetId, "error", message, canonicalAttempt!.id, turn.id, callbackRow.id));
        }
      }));
      await drainStreams();
      if (!isOwned()) return finalizeCancelled();
      const attemptUpdated = await updateAttemptStatus("error");
      if (!attemptUpdated) warn(uiText.t("chat.attemptStatusAfterDispatchErrorFailed"));
      return Object.values(fallback);
    }
    await drainStreams();
    // The provider may resolve at the same time the captured operation is
    // canceled. Do not turn that late success into a terminal done write; only
    // the exact already-persisted rows may be finalized as stopped.
    if (!isOwned()) return finalizeCancelled();

    const expectedTargetIds = new Set(built.prompts.map((prompt) => prompt.targetId));
    const seenTargetIds = new Set<string>();
    const outcomeContractValid = outcomes.length === expectedTargetIds.size && outcomes.every((outcome) => {
      if (outcome.operationId !== opId || !expectedTargetIds.has(outcome.targetId) || seenTargetIds.has(outcome.targetId)) return false;
      seenTargetIds.add(outcome.targetId);
      return true;
    });
    const finals: Record<string, ChatMessage> = {};
    let primaryFailed = false;

    if (!outcomeContractValid) {
      const contractError = uiText.t("chat.outcomeContractFailed");
      const terminalStatus: "error" | "stopped" = operationSignal.aborted ? "stopped" : "error";
      for (const row of assistantRows) {
        const targetId = row.targetId;
        if (!targetId) continue;
        if (!isOwned()) return finalizeCancelled();
        await settleTarget(targetId).catch(() => undefined);
        if (!isOwned()) return finalizeCancelled();
        const final: ChatMessage = {
          ...row,
          text: streams.get(targetId)?.accum ?? "",
          status: terminalStatus,
          error: terminalStatus === "error" ? contractError : undefined,
        };
        const accepted = await emitTerminal(final);
        if (!accepted) primaryFailed = true;
        finals[targetId] = accepted
          ? final
          : { ...final, status: "error" as const, error: final.error ?? uiText.t("errors.resultSaveFailed") };
        if (isOwned()) {
          observe(() => cb.onStatus(opId, targetId, final.status, final.error, canonicalAttempt!.id, turn.id, row.id));
        }
      }
      if (!isOwned()) return finalizeCancelled();
      warn(contractError);
      const attemptUpdated = await updateAttemptStatus(terminalStatus);
      if (primaryFailed || !attemptUpdated) warn(uiText.t("chat.primaryOrAttemptPinFailed"));
      return Object.values(finals);
    }

    const validOutcomes = outcomes;
    for (const outcome of validOutcomes) {
      const row = assistantRows.find((candidate) => candidate.targetId === outcome.targetId);
      if (!row) continue;
      if (!isOwned()) return finalizeCancelled();
      await settleTarget(outcome.targetId).catch(() => undefined);
      if (!isOwned()) return finalizeCancelled();
      const final: ChatMessage = {
        ...row,
        text: outcome.text,
        status: outcome.status,
        error: outcome.error,
        usage: outcome.usage,
      };
      const accepted = await emitTerminal(final);
      if (!accepted && durableRows.get(row.id)?.status !== outcome.status) primaryFailed = true;
      const published = accepted
        ? final
        : { ...final, status: "error" as const, error: final.error ?? uiText.t("errors.resultSaveFailed") };
      finals[outcome.targetId] = published;
      if (!accepted) {
        warn(uiText.t("chat.primaryPinFailed"));
        if (isOwned()) observe(() => cb.onStatus(opId, outcome.targetId, published.status, published.error, canonicalAttempt!.id, turn.id, row.id));
      } else if (isOwned()) {
        observe(() => cb.onStatus(opId, outcome.targetId, outcome.status, outcome.error, canonicalAttempt!.id, turn.id, row.id));
      }
    }
    await drainStreams();
    if (!isOwned()) return finalizeCancelled();
    const attemptStatus = primaryFailed ? "error" : statusForOutcomes(validOutcomes);
    const attemptUpdated = await updateAttemptStatus(attemptStatus);
    if (primaryFailed) {
      // A final append can fail after the streaming placeholder is durable. Make
      // one explicit terminal recovery attempt so a transient storage failure
      // never leaves a reload indistinguishable from an interrupted operation.
      for (const outcome of validOutcomes) {
        const row = assistantRows.find((candidate) => candidate.targetId === outcome.targetId);
        if (!row) continue;
        if (!isOwned()) return finalizeCancelled();
        const current = durableRows.get(row.id);
        if (current && isTerminal(current.status)) continue;
        const recovery: ChatMessage = {
          ...row,
          text: outcome.text,
          status: "error",
          error: uiText.t("errors.resultSaveFailed"),
          usage: outcome.usage,
        };
        if (await emitTerminal(recovery)) {
          finals[outcome.targetId] = recovery;
          if (isOwned()) observe(() => cb.onStatus(opId, outcome.targetId, recovery.status, recovery.error, canonicalAttempt!.id, turn.id, row.id));
        }
      }
    }
    if (primaryFailed || !attemptUpdated) {
      warn(uiText.t("chat.primaryOrAttemptPinFailed"));
      return Object.values(finals);
    }

    // Usage/archive are sidecars: only begin after the primary row and attempt are terminal.
    type SidecarResult = { targetId?: string; warning?: string };
    const sidecars: Promise<SidecarResult>[] = [];
    for (const outcome of validOutcomes) {
      const prompt = built.prompts.find((candidate) => candidate.targetId === outcome.targetId);
      if (!prompt) continue;
      sidecars.push(recordUsage({
        id: newId("u"),
        sessionId: session.id,
        turnId: turn.id,
        ts: Date.now(),
        providerId: prompt.providerId,
        modelId: prompt.modelId,
        inputTokens: outcome.usage?.inputTokens ?? 0,
        outputTokens: outcome.usage?.outputTokens ?? 0,
        cachedInputTokens: outcome.usage?.cachedInputTokens ?? 0,
        // [T2.4/NL-01] العدد المكتوب كان يسقط من صف السجل فيبقى غير مرئي حتى لو قرأه التحويل.
        cacheWriteInputTokens: outcome.usage?.cacheWriteInputTokens ?? 0,
        costUSD: outcome.usage?.costUSD ?? null,
        toolCalls: 0,
        durationMs: outcome.ms,
        status: outcome.status === "error" ? "error" : "ok",
        attemptId: canonicalAttempt.id,
        operationId: opId,
      }).then(() => ({})).catch(() => ({ targetId: outcome.targetId, warning: uiText.t("chat.usageEventSaveFailed") })));
    }
    if (dir && isFilePersistActive()) {
      sidecars.push(appendTurn(sink, dir, session, {
        turn: archiveTurn,
        prompts: built.prompts.map((prompt) => ({
          targetId: prompt.targetId,
          providerId: prompt.providerId,
          modelId: prompt.modelId,
          text: prompt.text,
          hasShared: prompt.hasShared,
          hasCustom: prompt.hasCustom,
        })),
        results: validOutcomes.map((outcome) => ({ targetId: outcome.targetId, text: outcome.text, usage: outcome.usage ?? null })),
        status: Object.fromEntries(validOutcomes.map((outcome) => [outcome.targetId, outcome.status])),
        errors: Object.fromEntries(validOutcomes.map((outcome) => [outcome.targetId, outcome.error ?? ""])),
        createdAt: canonicalAttempt.createdAt,
        attemptId: canonicalAttempt.id,
        attemptNumber: canonicalAttempt.attempt,
        kind: canonicalAttempt.kind,
        operationId: opId,
      }).then(async () => {
        const updated = await updateSessionIfOperation(session.id, opId, { onDisk: isFilePersistActive() }, isOwned);
        if (!updated) throw new Error("operation ownership changed before archive metadata update");
        return {};
      }).catch((e: unknown) => {
        console.error("Archive failed:", e);
        return { warning: uiText.t("chat.archiveFailed") };
      }));
    }
    const sidecarResults = await Promise.allSettled(sidecars);
    const warnings: Record<string, string[]> = {};
    for (const result of sidecarResults) {
      if (result.status !== "fulfilled" || !result.value.warning) continue;
      const warning = result.value.warning;
      if (result.value.targetId) (warnings[result.value.targetId] ??= []).push(warning);
      else for (const outcome of validOutcomes) (warnings[outcome.targetId] ??= []).push(warning);
    }
    if (!isOwned()) return finalizeCancelled();
    for (const outcome of validOutcomes) {
      if (!isOwned()) return finalizeCancelled();
      const targetWarnings = warnings[outcome.targetId];
      if (!targetWarnings?.length) continue;
      const row = { ...finals[outcome.targetId], sidecarWarning: targetWarnings.join(uiText.t("common.warningSeparator")) };
      finals[outcome.targetId] = row;
      const accepted = await emitTerminal(row);
      if (!accepted) warn(targetWarnings.join(uiText.t("common.warningSeparator")));
    }
    return Object.values(finals);
  } catch (error) {
    if (isCancellation(error)) return finalizeCancelled();
    if (canonicalAttempt) return finalizeSetupFailure(error);
    throw error;
  } finally {
    for (const bound of boundSignals.values()) bound.cleanup();
    if (ownsLease && leaseGeneration !== undefined) {
      await releaseOperationLease(session.id, opId, operationSignal.aborted ? "cancelled" : "finished").catch(() => undefined);
    }
  }
}
