import { toast } from "sonner";
import { useSessionsStore } from "@/state/sessionsStore";
import { sessionOperationCoordinator } from "@/lib/chat/operationCoordinator";
import { dispatchTurn } from "@/lib/chat/dispatch";
import { buildSummaryPrompt, buildSummaryTargetSnapshot } from "@/lib/chat/synthesis";
import { newId } from "@/lib/id";
import {
  appendMessage,
  claimOperationLease,
  persistTurnAttempt,
  recordUsage,
  releaseOperationLease,
  updateSessionIfOperation,
  updateTurnAttemptStatus,
} from "@/lib/db/repos";
import { getFileSink, isFilePersistActive } from "@/lib/markdown/sink";
import { appendTurn, sessionFolderName } from "@/lib/markdown/writer";
import { headersFor } from "@/lib/providers/registry";
import type { ChatMessage, ContextMode, ProviderId, SessionMeta, TargetConfig } from "@/types";
import type { TurnData } from "./useTurns";

export interface SummaryExtractionDeps {
  session: SessionMeta;
  sessionId: string;
  turns: [string, TurnData][];
  messages: readonly ChatMessage[];
  targets: readonly TargetConfig[];
  primaryTarget: { providerId: ProviderId; modelId: string } | null;
  providerKeys: Partial<Record<ProviderId, string>>;
  timeoutMs: number;
  contextMode: ContextMode;
  viewGenerationRef: { current: number };
  aborts: { current: Map<string, AbortController> };
  stopped: { current: Set<string> };
  upsertMessagesLocal: (
    msgs: ChatMessage[],
    options?: { allowNewerAttempt?: boolean; canPublish?: () => boolean },
  ) => void;
}

/**
 * Synthesis ("الخلاصة") extraction: asks the primary model to condense the last
 * turn's results into a durable synthesis row. The operation owns its own lease,
 * streaming checkpoints, cancellation recovery and sidecars, so the transcript
 * view stays focused on layout instead of storage choreography.
 */
export function useSummaryExtraction(deps: SummaryExtractionDeps): () => Promise<void> {
  const {
    session,
    sessionId,
    turns,
    messages,
    targets,
    primaryTarget,
    providerKeys,
    timeoutMs,
    contextMode,
    viewGenerationRef,
    aborts,
    stopped,
    upsertMessagesLocal,
  } = deps;

  async function extractSummary(): Promise<void> {
    if (sessionOperationCoordinator.isActive(sessionId)) {
      toast.warning("جارٍ تنفيذ عملية بالفعل");
      return;
    }
    const last = turns[turns.length - 1];
    if (!last || last[1].results.length === 0) {
      toast.warning("لا نتائج لاستخلاصها بعد");
      return;
    }
    if (last[0].startsWith("syn-")) {
      toast.warning("الخلاصة موجودة بالفعل — لا خلاصة فوق خلاصة");
      return;
    }
    const primary = primaryTarget ?? (targets[0] ? { providerId: targets[0].providerId, modelId: targets[0].modelId } : null);
    if (!primary) {
      toast.warning("حدد النموذج الأساسي من الإعدادات أولًا");
      return;
    }

    const turnId = "syn-" + session.id + "-" + last[0];
    const targetId = newId("syn-target");
    const messageId = newId("m");
    const createdAt = Date.now();
    const promptText = buildSummaryPrompt(last[0], last[1].results);
    const selected = targets.find((target) => target.providerId === primary.providerId && target.modelId === primary.modelId);
    const summaryTarget = {
      targetId,
      providerId: primary.providerId,
      modelId: primary.modelId,
      modelInfo: selected?.modelInfo ?? { id: primary.modelId, label: primary.modelId },
    };
    const targetSnapshot = buildSummaryTargetSnapshot(summaryTarget, promptText);
    const history = messages.filter((message) => message.sessionId === session.id);
    const viewGeneration = viewGenerationRef.current;
    const handle = sessionOperationCoordinator.start(sessionId, "summary", new AbortController());
    if (!handle) {
      toast.warning("جارٍ تنفيذ عملية بالفعل");
      return;
    }
    const operationId = handle.id;
    const attemptId = newId("at");
    const isCapturedSessionLive = (): boolean =>
      viewGenerationRef.current === viewGeneration && useSessionsStore.getState().currentId === session.id;
    // A canceled operation may finish only its durable rows. Live-store ownership
    // remains tied to the open coordinator entry; an empty active map is not a grant.
    const isLiveOwner = (): boolean => isCapturedSessionLive() &&
      sessionOperationCoordinator.isOperationOpen(operationId, session.id);
    // Durable ownership is operation-scoped and view-independent: switching away from
    // this session must not invalidate the live operation's own durable writes, so the
    // summary path mirrors the normal turn path and separates canPersist from canPublish.
    const operationIsCurrent = (): boolean =>
      !handle.controller.signal.aborted && sessionOperationCoordinator.accepts(operationId, session.id);
    // Finalization warnings must outlive live ownership: after cancellation, a same-session
    // remount, or progress publication the operation is no longer "live", yet a bounded
    // sidecar warning still has to reach the user. A replacement operation or another
    // session invalidates the tombstone and suppresses it.
    const isWarningVisible = (): boolean =>
      useSessionsStore.getState().currentId === session.id &&
      sessionOperationCoordinator.isLatestOperation(operationId, session.id);
    aborts.current.clear();
    stopped.current.clear();

    let accumulated = "";
    let persistedLength = 0;
    let streamClosing = false;
    let streamTerminated = false;
    let checkpointQueue: Promise<unknown> = Promise.resolve();
    let outcome: Awaited<ReturnType<typeof dispatchTurn>>[number] | undefined;
    let outcomeContractFailed = false;
    let canonicalAttempt: import("@/types").TurnAttempt | undefined;
    let operationGeneration: number | undefined;
    let primaryDurable = false;
    let placeholderDurable = false;
    let attemptTerminal: boolean;

    const checkpointWrite = (text: string): void => {
      if (streamClosing || !canonicalAttempt || !sessionOperationCoordinator.isLatestOperation(operationId, session.id)) return;
      const checkpointMessage: ChatMessage = {
        id: messageId,
        sessionId: session.id,
        turnId,
        createdAt,
        role: "assistant",
        kind: "synthesis",
        text,
        providerId: primary.providerId,
        modelId: primary.modelId,
        modelInfo: targetSnapshot.modelInfo,
        targetId,
        status: "streaming",
        attemptId,
        attempt: canonicalAttempt.attempt,
        operationId,
      };
      checkpointQueue = checkpointQueue.then(() => {
        // Checkpoints queued before cancellation must not create a new streaming
        // write after the operation loses ownership. The finalizer may still
        // repair a row that was already durable.
        if (handle.controller.signal.aborted || !sessionOperationCoordinator.isOperationOpen(operationId, session.id)) return undefined;
        return appendMessage(checkpointMessage);
      }).then((result) => {
        if (result?.accepted && isLiveOwner()) upsertMessagesLocal([result.current ?? checkpointMessage], { canPublish: isLiveOwner });
      }).catch(() => { /* a failed checkpoint never replaces the final row */ });
    };
    const streamTimer = setInterval(() => {
      if (streamClosing || streamTerminated || accumulated.length <= persistedLength) return;
      persistedLength = accumulated.length;
      checkpointWrite(accumulated);
    }, 250);
    const settleStream = async (): Promise<void> => {
      clearInterval(streamTimer);
      streamClosing = true;
      await checkpointQueue;
      streamTerminated = true;
    };
    const publishSummaryProgress = (text: string, status: ChatMessage["status"], error?: string): void => {
      if (!canonicalAttempt || !operationId || !attemptId) return;
      const message: ChatMessage = {
        id: messageId,
        sessionId: session.id,
        turnId,
        createdAt,
        role: "assistant",
        kind: "synthesis",
        text,
        providerId: primary.providerId,
        modelId: primary.modelId,
        modelInfo: targetSnapshot.modelInfo,
        status,
        error,
        attemptId,
        attempt: canonicalAttempt.attempt,
        operationId,
        targetId,
      };
      if (sessionOperationCoordinator.publishProgress({
        sessionId: session.id,
        operationId,
        attemptId,
        turnId,
        messageId,
        targetId,
        text,
        status,
        error,
        message,
      }) && isLiveOwner()) {
        try { upsertMessagesLocal([message], { canPublish: isLiveOwner }); } catch { /* a live observer failure cannot abort durable synthesis */ }
      }
    };
    const onDelta = (callbackOperationId: string, callbackTargetId: string, chunk: string, callbackAttemptId: string): void => {
      if (
        callbackOperationId !== operationId ||
        callbackTargetId !== targetId ||
        callbackAttemptId !== attemptId ||
        streamClosing ||
        streamTerminated ||
        !sessionOperationCoordinator.accepts(operationId, session.id)
      ) return;
      accumulated += chunk;
      if (persistedLength === 0 || accumulated.length - persistedLength >= 512) {
        persistedLength = accumulated.length;
        checkpointWrite(accumulated);
      }
      publishSummaryProgress(accumulated, "streaming");
    };
    const archiveSummary = async (
      text: string,
      status: "done" | "stopped" | "error",
      error: string | undefined,
      usage: ChatMessage["usage"],
    ): Promise<void> => {
      if (!isFilePersistActive()) return;
      let effectiveSession = session;
      if (!effectiveSession.onDiskDir) {
        const folder = sessionFolderName(effectiveSession.title, effectiveSession.id, effectiveSession.createdAt);
        const updated = await updateSessionIfOperation(effectiveSession.id, operationId, { onDiskDir: folder }, operationIsCurrent);
        if (!updated) throw new Error("تغيرت ملكية العملية قبل حفظ مسار الجلسة");
        if (isLiveOwner()) {
          useSessionsStore.setState((state) => ({
            sessions: state.sessions.map((item) => item.id === effectiveSession.id ? { ...item, onDiskDir: folder } : item),
          }));
        }
        effectiveSession = { ...effectiveSession, onDiskDir: folder };
      }
      await appendTurn(getFileSink(), "sessions/" + effectiveSession.onDiskDir, effectiveSession, {
        turn: { id: turnId, sharedPrompt: text, customs: {} },
        // A v2 synthesis entry carries the primary target snapshot so recovery can
        // attribute its usage instead of fabricating a provider.
        prompts: [{
          targetId,
          providerId: primary.providerId,
          modelId: primary.modelId,
          text,
          hasShared: true,
          hasCustom: false,
        }],
        results: [{ targetId, text, usage: usage ?? null }],
        status: { [targetId]: status },
        errors: error === undefined ? {} : { [targetId]: error },
        createdAt,
        attemptId,
        operationId,
      });
    };
    const runSummarySidecars = async (
      text: string,
      status: "done" | "stopped" | "error",
      error: string | undefined,
      usage: ChatMessage["usage"],
      durationMs: number | undefined,
    ): Promise<string | undefined> => {
      const sidecars: Promise<{ warning?: string }>[] = [];
      if (durationMs !== undefined) {
        sidecars.push(
          recordUsage({
            id: newId("u"),
            sessionId: session.id,
            turnId,
            ts: Date.now(),
            providerId: primary.providerId,
            modelId: primary.modelId,
            inputTokens: usage?.inputTokens ?? 0,
            outputTokens: usage?.outputTokens ?? 0,
            cachedInputTokens: usage?.cachedInputTokens ?? 0,
            costUSD: usage?.costUSD ?? null,
            toolCalls: 0,
            durationMs,
            status: status === "error" ? "error" : "ok",
            attemptId,
            operationId,
          }).then(() => ({})).catch(() => ({ warning: "تعذر حفظ حدث الاستهلاك" })),
        );
      }
      if (isFilePersistActive()) {
        sidecars.push(archiveSummary(text, status, error, usage).then(() => ({})).catch(() => ({ warning: "حُفظت الخلاصة محليًا وفشل أرشفتها على القرص" })));
      }
      const settled = await Promise.allSettled(sidecars);
      const warnings = settled
        .filter((result): result is PromiseFulfilledResult<{ warning?: string }> => result.status === "fulfilled")
        .map((result) => result.value.warning)
        .filter((warning): warning is string => Boolean(warning));
      return warnings.length ? warnings.join(" ؛ ") : undefined;
    };
    const appendSummaryRow = async (message: ChatMessage, canAppend?: () => boolean): Promise<boolean> => {
      const result = await appendMessage(message, canAppend);
      if (result.accepted && isLiveOwner()) {
        try { upsertMessagesLocal([result.current ?? message], { canPublish: isLiveOwner }); } catch { /* durable row remains authoritative */ }
      }
      return result.accepted;
    };
    const updateSummaryAttemptStatus = async (status: "done" | "stopped" | "error"): Promise<boolean> => {
      if (!canonicalAttempt) return false;
      for (let retry = 0; retry < 2; retry += 1) {
        try {
          if (await updateTurnAttemptStatus(turnId, canonicalAttempt.id, status, canonicalAttempt.operationId)) return true;
        } catch { /* retry once, then keep sidecars gated */ }
      }
      return false;
    };

    try {
      operationGeneration = await claimOperationLease(
        session.id,
        operationId,
        turnId,
        () => !handle.controller.signal.aborted && sessionOperationCoordinator.accepts(operationId, session.id),
      );
      const attempt: import("@/types").TurnAttempt = {
        id: attemptId,
        turnId,
        attempt: 0,
        kind: "summary",
        createdAt,
        status: "streaming",
        operationId,
        targets: [targetSnapshot],
      };
      canonicalAttempt = await persistTurnAttempt(
        session.id,
        turnId,
        attempt,
        contextMode,
        promptText,
        () => !handle.controller.signal.aborted && sessionOperationCoordinator.accepts(operationId, session.id),
        operationGeneration,
      );
      if (!canonicalAttempt) throw new Error("تعذر حفظ محاولة الخلاصة");
      if (!sessionOperationCoordinator.accepts(operationId, session.id) || handle.controller.signal.aborted) {
        throw new Error("أُلغيت عملية الخلاصة");
      }
      const promptMessage: ChatMessage = {
        id: newId("m"),
        sessionId: session.id,
        turnId,
        createdAt: createdAt - 1,
        role: "user",
        kind: "prompt",
        text: "طلب خلاصة من النموذج الأساسي",
        promptKind: "shared",
        status: "done",
        attemptId: canonicalAttempt.id,
        attempt: canonicalAttempt.attempt,
        operationId,
      };
      if (!(await appendSummaryRow(promptMessage))) throw new Error("تعذر حفظ سؤال الخلاصة");
      const placeholder: ChatMessage = {
        id: messageId,
        sessionId: session.id,
        turnId,
        createdAt,
        role: "assistant",
        kind: "synthesis",
        text: "",
        providerId: primary.providerId,
        modelId: primary.modelId,
        modelInfo: targetSnapshot.modelInfo,
        targetId,
        status: "streaming",
        attemptId: canonicalAttempt.id,
        attempt: canonicalAttempt.attempt,
        operationId,
      };
      if (!(await appendSummaryRow(placeholder))) throw new Error("تعذر حفظ بطاقة الخلاصة");
      placeholderDurable = true;
      if (!sessionOperationCoordinator.accepts(operationId, session.id) || handle.controller.signal.aborted) {
        throw new Error("أُلغيت عملية الخلاصة");
      }
      // No await is allowed between this final ownership check and frozen dispatch invocation.
      try {
        const dispatchedOutcomes = await dispatchTurn({
          operationId,
          sessionId: session.id,
          turnId,
          prompts: [{ targetId, providerId: primary.providerId, modelId: primary.modelId, text: promptText, hasShared: true, hasCustom: false }],
          apiKeyFor: (providerId) => providerKeys[providerId] ?? "",
          sessionHeaderFor: (providerId) => headersFor(providerId, session.id),
          timeoutMs,
          contextMode,
          multiStepTools: false,
          historyFor: () => history,
          modelInfoFor: () => targetSnapshot.modelInfo,
          externalSignalFor: () => handle.controller.signal,
          onUpdate: (callbackOperationId, callbackTargetId, chunk) => {
            onDelta(callbackOperationId, callbackTargetId, chunk, canonicalAttempt!.id);
          },
        });
        if (dispatchedOutcomes.length !== 1 || dispatchedOutcomes[0]?.operationId !== operationId || dispatchedOutcomes[0]?.targetId !== targetId) {
          outcomeContractFailed = true;
          throw new Error("نتيجة الخلاصة غير مطابقة للهوية");
        }
        outcome = dispatchedOutcomes[0];
      } finally {
        await settleStream();
      }
      // The pre-dispatch gate is no longer the only boundary: a cancel that lands after
      // dispatch settled must terminally recover the durable placeholder as stopped
      // instead of publishing a late "done" and then running success-only sidecars.
      if (!operationIsCurrent()) {
        throw new Error("أُلغيت عملية الخلاصة بعد انتهاء البث");
      }
      if (!outcome) throw new Error("لم تُرجع عملية الخلاصة نتيجة");
      const finalMessage: ChatMessage = {
        ...placeholder,
        text: outcome.text,
        status: outcome.status,
        error: outcome.error,
        usage: outcome.usage,
      };
      // The success claim binds to the captured operation inside the write transaction so
      // a cancellation that lands while this append is in flight cannot be published as done.
      primaryDurable = await appendSummaryRow(finalMessage, operationIsCurrent);
      if (!primaryDurable) throw new Error("تعذر حفظ النتيجة الأساسية للخلاصة");
      publishSummaryProgress(finalMessage.text, finalMessage.status, finalMessage.error);
      if (outcome.status === "error" && isLiveOwner()) toast.error(outcome.error ?? "فشل");
      attemptTerminal = await updateSummaryAttemptStatus(outcome.status);
      if (!attemptTerminal) {
        if (isLiveOwner()) toast.warning("تعذر تثبيت حالة المحاولة بعد حفظ خلاصة");
        return;
      }
      const sidecarWarning = await runSummarySidecars(outcome.text, outcome.status, outcome.error, outcome.usage, outcome.ms);
      if (sidecarWarning) {
        const warned: ChatMessage = { ...finalMessage, sidecarWarning };
        const warningAccepted = await appendMessage(warned).then((result) => result.accepted).catch(() => false);
        if (warningAccepted && isLiveOwner()) {
          try { upsertMessagesLocal([warned], { canPublish: isLiveOwner }); } catch { /* warning row remains durable even if the live observer fails */ }
        }
        if (isWarningVisible()) toast.warning(sidecarWarning);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await settleStream().catch(() => clearInterval(streamTimer));
      if (primaryDurable) {
        if (isLiveOwner()) toast.warning("تعذر تثبيت حالة النتيجة الأساسية للخلاصة");
        return;
      }
      if (!canonicalAttempt) {
        if (isLiveOwner()) toast.error(message);
        return;
      }
      // A cancellation is not a provider/storage failure: recover the durable row as
      // stopped and keep every success-only sidecar gated behind real ownership.
      const cancelled = handle.controller.signal.aborted || !operationIsCurrent();
      const terminalStatus: "stopped" | "error" = cancelled ? "stopped" : "error";
      const terminalError = terminalStatus === "error" ? message : undefined;
      const attemptUpdated = await updateSummaryAttemptStatus(terminalStatus);
      const partial = outcome?.text ?? accumulated;
      const recovered: ChatMessage = {
        id: messageId,
        sessionId: session.id,
        turnId,
        createdAt,
        role: "assistant",
        kind: "synthesis",
        text: partial,
        providerId: primary.providerId,
        modelId: primary.modelId,
        modelInfo: targetSnapshot.modelInfo,
        targetId,
        status: terminalStatus,
        error: terminalError,
        usage: outcome?.usage,
        attemptId: canonicalAttempt.id,
        attempt: canonicalAttempt.attempt,
        operationId,
      };
      const recoveredPersisted = placeholderDurable ? await appendSummaryRow(recovered) : false;
      if (!placeholderDurable) {
        if (!attemptUpdated && isLiveOwner()) toast.warning("تعذر تحديث حالة محاولة الخلاصة");
        return;
      }
      if (!recoveredPersisted) {
        if (isLiveOwner()) toast.warning("تعذر حفظ النتيجة النهائية للخلاصة");
        return;
      }
      if (!attemptUpdated) {
        if (isLiveOwner()) toast.warning("تعذر تحديث حالة محاولة الخلاصة");
        return;
      }
      publishSummaryProgress(recovered.text, recovered.status, recovered.error);
      if (terminalStatus === "error" && isLiveOwner()) toast.error(message);
      // A canceled or superseded operation never runs success-only sidecars, and an
      // identity contract failure must not be archived as a normal result either.
      if (outcomeContractFailed || cancelled) return;
      const sidecarWarning = await runSummarySidecars(partial, terminalStatus, terminalError, outcome?.usage, outcome?.ms);
      if (sidecarWarning) {
        const warned: ChatMessage = { ...recovered, sidecarWarning };
        const warningAccepted = await appendMessage(warned).then((result) => result.accepted).catch(() => false);
        if (warningAccepted && isLiveOwner()) {
          try { upsertMessagesLocal([warned], { canPublish: isLiveOwner }); } catch { /* warning row remains durable even if the live observer fails */ }
        }
        if (isWarningVisible()) toast.warning(sidecarWarning);
      }
    } finally {
      await settleStream().catch(() => clearInterval(streamTimer));
      if (operationGeneration !== undefined) {
        await releaseOperationLease(session.id, operationId, handle.controller.signal.aborted ? "cancelled" : "finished").catch(() => undefined);
      }
      const owned = sessionOperationCoordinator.accepts(operationId, session.id);
      sessionOperationCoordinator.finish(operationId, session.id);
      if (owned) {
        aborts.current.clear();
        stopped.current.clear();
      }
    }
  }
  return extractSummary;
}
