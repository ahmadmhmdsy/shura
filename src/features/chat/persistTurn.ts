/**
 * [T4.1] تمريرة الإرسال/الإعادة كوحدة مستقلة عن مكوّن العرض. كل ما تحتاجه من الشاشة يصل
 * عبر كائن تبعيات صريح (الجلسة، اللغة، الأهداف، المراجع الحيّة، كاتب الحالة)، والوصول إلى
 * المخازن وقاعدة البيانات ومرآب الملفات يمرّ عبر الوحدات المشتركة، فتُختبر الدالة بلا تركيب
 * React. النقل حرفي: لا تغيير سلوكي في هذه المهمة.
 */
import { toast } from "sonner";
import { useSessionsStore } from "@/state/sessionsStore";
import { useSettingsStore } from "@/state/settingsStore";
import { newId } from "@/lib/id";
import { incrementMessageCount } from "@/lib/logging";
import { scheduleTempCleanup } from "@/lib/rag/tempCleanup";
import { sessionOperationCoordinator, buildRetryInput } from "@/lib/chat/operationCoordinator";
import { sendTurn } from "@/lib/chat/chatController";
import { messageErrorText } from "@/lib/chat/messageError";
import { errorText } from "@/lib/errors/keyedError";
import { claimOperationLease, getTurn, persistTurnAttempt, releaseOperationLease, selectPersistedRetryAttempt, updateSessionIfOperation } from "@/lib/db/repos";
import { isFilePersistActive } from "@/lib/markdown/sink";
import { sessionFolderName } from "@/lib/markdown/writer";
import { headersFor } from "@/lib/providers/registry";
import type { Dispatch, SetStateAction } from "react";
import type { UiText } from "@/i18n";
import type { ChatMessage, ContextMode, SessionMeta, TargetConfig, Turn } from "@/types";

/** كائن التبعيات الصريح: كل ما كانت الدالة تقرأه من نطاق المكوّن. */
export interface PersistTurnDeps extends Pick<UiText, "t" | "plural"> {
  session: SessionMeta;
  sessionId: string;
  targets: TargetConfig[];
  syncMode: boolean;
  providerKeys: Record<string, string>;
  timeoutMs: number;
  contextMode: ContextMode;
  multiStepTools: boolean;
  upsertMessagesLocal(messages: ChatMessage[], options?: { allowNewerAttempt?: boolean; canPublish?: () => boolean }): void;
  setToolErrors: Dispatch<SetStateAction<Record<string, { toolName: string; error: string }>>>;
  setToolActivity: Dispatch<SetStateAction<Record<string, string>>>;
  aborts: { current: Map<string, AbortController> };
  stopped: { current: Set<string> };
  viewGenerationRef: { current: number };
}

export async function persistTurn(
  deps: PersistTurnDeps,
  turn: Turn,
  retryTargetId?: string,
  baseResults?: ChatMessage[],
  assistantIds?: Record<string, string>,
): Promise<void> {
  const { session, sessionId, t, plural, targets, syncMode, providerKeys, timeoutMs, contextMode, multiStepTools, upsertMessagesLocal, setToolErrors, setToolActivity, aborts, stopped, viewGenerationRef } = deps;
    const kind = retryTargetId ? "retry" : "send";
    const handle = sessionOperationCoordinator.start(sessionId, kind, new AbortController());
    if (!handle) {
      toast.warning(t("chat.operationInProgress"));
      return;
    }
    // تمرّة جديدة تمحو أخطاء الأدوات السابقة — لا تبقى مُلاحظات عالقة من تمرّة قديمة.
    setToolErrors({});
    const opId = handle.id;
    // عدّاد الرسائل: كل تمرّة جديدة تعني رسالة مستخدم واحدة؛ الإعادة لا تضيف رسالة.
    if (!retryTargetId) incrementMessageCount();
    const attemptId = newId("at");
    let operationGeneration: number | undefined;
    let sourceAttempt: import("@/types").TurnAttempt | undefined;
    // A retry's source attempt is attempt 0/legacy; sendTurn assigns the new
    // monotonic number only after persistence. Learn that number from the first
    // exact placeholder callback instead of treating the source number as the
    // live message coordinate.
    let currentAttemptNumber: number | undefined;
    const expectedMessageIds = new Map<string, string>();
    const viewGeneration = viewGenerationRef.current;
    const operationIsCurrent = (): boolean =>
      !handle.controller.signal.aborted && sessionOperationCoordinator.accepts(opId, sessionId);
    const isLiveView = (): boolean =>
      viewGenerationRef.current === viewGeneration &&
      useSessionsStore.getState().currentId === sessionId;
    const isCurrent = (): boolean => isLiveView() && operationIsCurrent();
    // Finalization warnings are deliberately delivered after cancellation releases
    // the active slot. Keep them visible to the current view for the latest
    // operation, while a replacement or a different session invalidates the tombstone.
    const isWarningVisible = (): boolean =>
      useSessionsStore.getState().currentId === sessionId &&
      sessionOperationCoordinator.isLatestOperation(opId, sessionId);
    const acceptsOperationCallback = (callbackOperationId: string, callbackAttemptId: string, callbackTurnId: string): boolean =>
      operationIsCurrent() && callbackOperationId === opId && callbackAttemptId === attemptId && callbackTurnId === turn.id;
    const acceptsCallback = (callbackOperationId: string, callbackAttemptId: string, callbackTurnId: string, callbackMessageId?: string): boolean =>
      acceptsOperationCallback(callbackOperationId, callbackAttemptId, callbackTurnId) && callbackMessageId !== undefined;
    const exactMessage = (targetId: string, expectedTurnId = turn.id, expectedMessageId?: string, rows: readonly ChatMessage[] = useSessionsStore.getState().messages): ChatMessage | undefined => {
      if (!expectedMessageId || expectedMessageIds.get(targetId) !== expectedMessageId) return undefined;
      const matches = (candidate: ChatMessage): boolean =>
        candidate.sessionId === sessionId &&
        candidate.turnId === expectedTurnId &&
        candidate.role === "assistant" &&
        (candidate.kind === "result" || candidate.kind === "synthesis") &&
        candidate.targetId === targetId &&
        candidate.operationId === opId &&
        candidate.attemptId === attemptId &&
        (currentAttemptNumber === undefined || candidate.attempt === currentAttemptNumber) &&
        candidate.id === expectedMessageId;
      const stored = [...rows].reverse().find(matches);
      if (stored) return stored;
      return [...sessionOperationCoordinator.progressFor(sessionId)].reverse().find((entry) => matches(entry.message))?.message;
    };
    const isCanonicalAssistantMessage = (message: ChatMessage): boolean => {
      const expectedTargets = sourceAttempt?.targets ?? targets;
      const expectedTarget = expectedTargets.find((target) => target.targetId === message.targetId);
      return message.sessionId === sessionId &&
        expectedMessageIds.get(message.targetId ?? "") === message.id &&
        message.turnId === turn.id &&
        message.role === "assistant" &&
        (message.kind === "result" || message.kind === "synthesis") &&
        message.operationId === opId &&
        message.attemptId === attemptId &&
        typeof message.attempt === "number" &&
        message.attempt > 0 &&
        (currentAttemptNumber === undefined || message.attempt === currentAttemptNumber) &&
        Boolean(expectedTarget) &&
        message.providerId === expectedTarget?.providerId &&
        message.modelId === expectedTarget?.modelId &&
        Boolean(message.modelInfo);
    };
    const publishMessageProgress = (message: ChatMessage, text = message.text, status = message.status, error = message.error, reasoning?: boolean): boolean => {
      if (!operationIsCurrent() || !isCanonicalAssistantMessage(message)) return false;
      // [T2.7/LV-02] undefined يعني «لا تمسّ الحالة»؛ false يعني «امسحها» — فلا يمحوها تحديث نص عادي.
      const next = { ...message, text, status, error, ...(reasoning === undefined ? {} : { reasoning }) };
      const published = sessionOperationCoordinator.publishProgress({
        sessionId,
        operationId: opId,
        attemptId: message.attemptId!,
        turnId: message.turnId,
        messageId: message.id,
        targetId: message.targetId ?? "",
        text,
        status,
        error,
        message: next,
      });
      if (published && isLiveView()) upsertMessagesLocal([next], { allowNewerAttempt: true, canPublish: isLiveView });
      return published;
    };
    const historySnapshot = useSessionsStore.getState().messages
      .filter((message) => message.sessionId === sessionId)
      .map((message) => ({ ...message }));
    aborts.current.clear();
    stopped.current.clear();
    const targetControllers = new Map<string, AbortController>();
    const abortTargets = (): void => {
      for (const controller of targetControllers.values()) controller.abort(handle.controller.signal.reason ?? new Error(t("chat.internal.operationCancelled")));
    };
    handle.controller.signal.addEventListener("abort", abortTargets, { once: true });
    try {
      operationGeneration = await claimOperationLease(sessionId, opId, turn.id, operationIsCurrent);
      if (!operationIsCurrent()) return;
      if (retryTargetId) {
        const record = await getTurn(turn.id);
        if (record && record.sessionId !== sessionId) throw new Error(t("chat.internal.sessionIdentityConflict"));
        const result = baseResults?.[0] ?? historySnapshot.find((candidate) =>
          candidate.sessionId === sessionId && candidate.turnId === turn.id && candidate.role === "assistant" && candidate.targetId === retryTargetId,
        );
        if (record) {
          const persisted = selectPersistedRetryAttempt(record, result, retryTargetId);
          if (!persisted) throw new Error(t("chat.internal.attemptNotFound"));
          const stable = buildRetryInput(persisted);
          const stableTarget = stable.targets.find((target) => target.targetId === retryTargetId);
          if (!stableTarget) throw new Error(t("chat.internal.targetMismatch"));
          sourceAttempt = { ...persisted, targets: [stableTarget] };
        } else {
          const shared = historySnapshot.find((candidate) =>
            candidate.sessionId === sessionId && candidate.turnId === turn.id && candidate.role === "user" && candidate.promptKind === "shared",
          )?.text.trim() || turn.sharedPrompt?.trim() || null;
          const custom = historySnapshot.find((candidate) =>
            candidate.sessionId === sessionId && candidate.turnId === turn.id && candidate.role === "user" && candidate.promptKind === "custom" && candidate.targetId === retryTargetId,
          )?.text.trim() || turn.customs[retryTargetId]?.trim() || null;
          if (
            !result?.targetId || !result.providerId || !result.modelId || !result.modelInfo ||
            (!shared && !custom)
          ) throw new Error(t("chat.internal.staleAttemptIncomplete"));
          const promptText = shared && custom
            ? shared + t("chat.customInstructionsMarker") + custom
            : (custom ?? shared!);
          const legacy: import("@/types").TurnAttempt = {
            id: "legacy-" + turn.id,
            turnId: turn.id,
            attempt: 0,
            kind: "retry",
            createdAt: result.createdAt,
            status: "error",
            operationId: opId,
            // The legacy row has no operation identity of its own. Record the exact
            // message this snapshot came from so a later retry can find this attempt
            // durably even if this operation is canceled before sendTurn.
            sourceMessageId: result.id,
            targets: [{
              targetId: result.targetId,
              providerId: result.providerId,
              modelId: result.modelId,
              modelInfo: { ...result.modelInfo },
              sharedPrompt: shared,
              customPrompt: custom,
              promptText,
              hasShared: shared !== null,
              hasCustom: custom !== null,
            }],
          };
          sourceAttempt = await persistTurnAttempt(
            sessionId,
            turn.id,
            legacy,
            contextMode,
            shared,
            operationIsCurrent,
            operationGeneration,
          );
        }
      }
      currentAttemptNumber = sourceAttempt ? undefined : 1;
      if (!sessionOperationCoordinator.accepts(opId, sessionId)) return;
      const signalTargets = retryTargetId
        ? (sourceAttempt?.targets ?? []).map((target) => ({ targetId: target.targetId, providerId: target.providerId, modelId: target.modelId }))
        : targets;
      for (const target of signalTargets) {
        expectedMessageIds.set(target.targetId, assistantIds?.[target.targetId] ?? newId("m"));
      }
      let effectiveSession = session;
      if (!effectiveSession.onDiskDir && isFilePersistActive()) {
        const folder = sessionFolderName(effectiveSession.title, effectiveSession.id, effectiveSession.createdAt);
        const updated = await updateSessionIfOperation(effectiveSession.id, opId, { onDiskDir: folder }, operationIsCurrent);
        if (!updated) throw new Error(t("chat.internal.operationOwnershipChanged"));
        if (isCurrent()) useSessionsStore.setState((state) => ({ sessions: state.sessions.map((item) => item.id === effectiveSession.id ? { ...item, onDiskDir: folder } : item) }));
        effectiveSession = { ...effectiveSession, onDiskDir: folder };
      }
      if (!sessionOperationCoordinator.accepts(opId, sessionId)) return;
      await sendTurn(
        {
          session: effectiveSession,
          turn: sourceAttempt ? { id: turn.id, sharedPrompt: null, customs: {} } : turn,
          targets: signalTargets.map((target) => ({ targetId: target.targetId, providerId: target.providerId, modelId: target.modelId })),
          syncMode: retryTargetId ? false : syncMode,
          operationId: opId,
          attemptId,
          kind,
          attempt: sourceAttempt,
          operationSignal: handle.controller.signal,
          operationIsCurrent,
          operationGeneration,
          contextMode,
          multiStepTools,
          historyFor: () => historySnapshot,
          modelInfoFor: (targetId) => sourceAttempt?.targets.find((target) => target.targetId === targetId)?.modelInfo ?? targets.find((target) => target.targetId === targetId)?.modelInfo ?? { id: targetId, label: targetId },
          apiKeyFor: (providerId) => providerKeys[providerId] ?? "",
          sessionHeaderFor: (providerId) => headersFor(providerId, session.id),
          externalSignalFor: () => handle.controller.signal,
          timeoutMs,
          assistantIds: Object.fromEntries(expectedMessageIds),
          assistantCreatedAts: baseResults?.[0] && retryTargetId ? { [retryTargetId]: baseResults[0].createdAt } : undefined,
        },
        {
          onDelta: (callbackOperationId, targetId, chunk, callbackAttemptId, callbackTurnId, callbackMessageId) => {
            if (!acceptsCallback(callbackOperationId, callbackAttemptId, callbackTurnId ?? "", callbackMessageId)) return;
            const message = exactMessage(targetId, callbackTurnId, callbackMessageId);
            if (!message) return;
            publishMessageProgress(message, message.text + chunk, "streaming");
          },
          onReasoning: (callbackOperationId, targetId, active, callbackAttemptId, callbackTurnId, callbackMessageId) => {
            if (!acceptsCallback(callbackOperationId, callbackAttemptId, callbackTurnId ?? "", callbackMessageId)) return;
            const message = exactMessage(targetId, callbackTurnId, callbackMessageId);
            if (!message) return;
            publishMessageProgress(message, message.text, message.status, message.error, active);
          },
          onStatus: (callbackOperationId, targetId, status, error, callbackAttemptId, callbackTurnId, callbackMessageId) => {
            if (!acceptsCallback(callbackOperationId, callbackAttemptId, callbackTurnId ?? "", callbackMessageId)) return;
            const message = exactMessage(targetId, callbackTurnId, callbackMessageId);
            if (!message) return;
            publishMessageProgress(message, message.text, status, error);
            if (status === "error" && error && isCurrent()) toast.error(messageErrorText(t, error));
          },
          onDropped: (callbackOperationId, targetIds, callbackAttemptId, callbackTurnId) => {
            if (targetIds.length && isCurrent() && acceptsOperationCallback(callbackOperationId, callbackAttemptId, callbackTurnId ?? "")) toast.warning(plural("chat.droppedTargets", targetIds.length));
          },
          onWarning: (warning) => {
            if (isWarningVisible()) toast.warning(warning);
          },
          onToolExecutionStart: (targetId, toolName) => {
            setToolActivity((prev) => ({ ...prev, [targetId]: toolName }));
          },
          onToolExecutionEnd: (targetId) => {
            setToolActivity((prev) => {
              const next = { ...prev };
              delete next[targetId];
              return next;
            });
            // نجاح الأداة يمحو أي خطأ سابق لنفس الهدف ضمن التمرّة الجارية.
            setToolErrors((prev) => {
              if (!(targetId in prev)) return prev;
              const next = { ...prev };
              delete next[targetId];
              return next;
            });
          },
          onToolExecutionError: (targetId, toolName, error) => {
            setToolErrors((prev) => ({ ...prev, [targetId]: { toolName, error } }));
          },
          onAppended: (message) => {
            if (!acceptsOperationCallback(message.operationId ?? "", message.attemptId ?? "", message.turnId)) return;
            if (isCanonicalAssistantMessage(message)) {
              currentAttemptNumber = message.attempt;
              publishMessageProgress(message, message.text, message.status, message.error);
              return;
            }
            // A user prompt row is durable but is not a progress target. It still has to
            // reach the live store: without it the transcript loses the question until a
            // reload, and the next stateful turn in this session sends no history at all.
            if (message.role === "user" && message.sessionId === sessionId) {
              upsertMessagesLocal([message], { canPublish: isLiveView });
            }
          },
        },
      );
    } catch (error) {
      // [T3.2b] الحدّ الوحيد: خطأ مُفتَّح يُترجَم إلى اللغة النشطة، وغيره يحتفظ برسالته.
      if (isCurrent()) toast.error(errorText(t, error));
    } finally {
      handle.controller.signal.removeEventListener("abort", abortTargets);
      if (operationGeneration !== undefined) {
        await releaseOperationLease(sessionId, opId, handle.controller.signal.aborted ? "cancelled" : "finished").catch(() => undefined);
      }
      const owned = sessionOperationCoordinator.accepts(opId, sessionId);
      sessionOperationCoordinator.finish(opId, sessionId);
      if (owned) {
        aborts.current.clear();
        stopped.current.clear();
      }
      // [T8.1] تنظيف الملفات المؤقتة بعد انتهاء التمرّة وفق الإعداد (after_turn فقط).
      // أفضل جهد: فشل التنظيف لا يُفشل التمرّة.
      try {
        await scheduleTempCleanup(useSettingsStore.getState().ragSettings.tempCleanup, sessionId);
      } catch {
        // تجاهُل مقصود.
      }
    }
  }
