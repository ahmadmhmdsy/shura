import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useShallow } from "zustand/react/shallow";
import { toast } from "sonner";
import { Composer } from "./Composer";
import { TurnView } from "./TurnView";
import { SessionExportDialog } from "./SessionExportDialog";
import { useChatShortcuts } from "./hooks/useChatShortcuts";
import { useOperationProgressSync } from "./hooks/useOperationProgressSync";
import { useSummaryExtraction } from "./hooks/useSummaryExtraction";
import { useTurns } from "./hooks/useTurns";
import { RagStatusChip } from "@/features/rag/RagStatusChip";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { useSessionsStore } from "@/state/sessionsStore";
import { useComposerStore, EMPTY_COMPOSER_DRAFT } from "@/state/composerStore";
import { useSettingsStore } from "@/state/settingsStore";
import { estimateSessionTokens } from "@/lib/tokens/estimate";
import { sendTurn } from "@/lib/chat/chatController";
import { incrementMessageCount } from "@/lib/logging";
import { sessionOperationCoordinator, buildRetryInput } from "@/lib/chat/operationCoordinator";
import { newId } from "@/lib/id";
import { claimOperationLease, getTurn, persistTurnAttempt, releaseOperationLease, selectPersistedRetryAttempt, updateSession, updateSessionIfOperation } from "@/lib/db/repos";
import { isFilePersistActive } from "@/lib/markdown/sink";
import { sessionFolderName } from "@/lib/markdown/writer";
import { headersFor } from "@/lib/providers/registry";
import { ar } from "@/i18n/ar";
import type { ChatMessage, ContextMode, SessionMeta, Turn } from "@/types";

function advanceViewGeneration(ref: { current: number }): void {
  ref.current += 1;
}

export function ChatScreen({ session, onOpenSettings }: { session: SessionMeta; onOpenSettings(): void }) {
  // الربط الموقّع: كل القراءات والأكشنات تحمل معرف الجلسة نفسه — لا سطح مؤلف شامل بعد الخطوة 5
  const sessionId = session.id;
  const messages = useSessionsStore((s) => s.messages);
  const sessionLoading = useSessionsStore((s) => s.loading && s.currentId === sessionId);
  const upsertMessagesLocal = useSessionsStore((s) => s.upsertMessagesLocal);
  const setTargets = useSessionsStore((s) => s.setTargets);
  const { targets, syncMode, sharedPrompt, customs, focusTargetId } = useComposerStore(useShallow((s) => {
    const d = s.drafts[sessionId] ?? EMPTY_COMPOSER_DRAFT;
    return { targets: d.targets, syncMode: d.syncMode, sharedPrompt: d.sharedPrompt, customs: d.customs, focusTargetId: d.focusTargetId };
  }));
  // [M9] Use selectors to prevent re-renders on unrelated settings changes.
  // Only subscribe to the specific slices that ChatScreen actually reads.
  const providerKeys = useSettingsStore((s) => s.providerKeys);
  const timeoutMs = useSettingsStore((s) => s.timeoutMs);
  const primaryTarget = useSettingsStore((s) => s.primaryTarget);
  const [toolActivity, setToolActivity] = useState<Record<string, string>>({});
  const [exportOpen, setExportOpen] = useState(false);
  const [toolErrors, setToolErrors] = useState<Record<string, { toolName: string; error: string }>>({});
  const agentMode = useComposerStore((s) => (s.drafts[sessionId] ?? EMPTY_COMPOSER_DRAFT).agentMode);
  const ragSettings = useSettingsStore((s) => s.ragSettings);
  const multiStepTools = ragSettings.agentMode === "always" || agentMode;
  const subscribeOperations = useCallback((listener: () => void) => sessionOperationCoordinator.subscribe(listener), []);
  const operationSnapshot = useCallback(() => sessionOperationCoordinator.getVersion(), []);
  const operationVersion = useSyncExternalStore(subscribeOperations, operationSnapshot, () => 0);
  const operationActive = sessionOperationCoordinator.isActive(sessionId);
  const operationProgress = useMemo(() => {
    // operationVersion is the coordinator's reactive invalidation token; consume it
    // explicitly so a remount/open rehydrates the latest progress snapshot.
    return operationVersion >= 0 ? sessionOperationCoordinator.progressFor(sessionId) : [];
  }, [sessionId, operationVersion]);
  // [M10] Hydration from the coordinator's buffered progress lives in its own hook so the
  // transcript view stays focused on layout; see useOperationProgressSync for the identity guards.
  useOperationProgressSync(sessionId, sessionLoading, operationProgress, upsertMessagesLocal);
  const sending = operationActive;
  const activeOperation = sessionOperationCoordinator.activeFor(sessionId);
  const hasLivePrimary = useMemo(() => Boolean(activeOperation && messages.some((message) =>
    message.sessionId === sessionId && message.role === "assistant" &&
    message.operationId === activeOperation.id && (message.status === "pending" || message.status === "streaming"))), [activeOperation, messages, sessionId]);
  const hasLiveProgress = useMemo(() => operationProgress.some((progress) => progress.status === "pending" || progress.status === "streaming"), [operationProgress]);
  // Before hydration the coordinator is the only trustworthy owner; after a terminal primary,
  // progress has no live entries so sidecar-only work is intentionally not cancellable.
  const cancellable = useMemo(() => Boolean(operationActive && (hasLivePrimary || hasLiveProgress || operationProgress.length === 0)), [operationActive, hasLivePrimary, hasLiveProgress, operationProgress]);
  const stopDisabledFor = useMemo(() => (message: ChatMessage): boolean => {
    const active = sessionOperationCoordinator.activeFor(sessionId);
    if (!active || !cancellable) return true;
    return message.sessionId !== sessionId || message.role !== "assistant" || message.status !== "streaming" ||
      message.operationId !== active.id || !message.attemptId || !message.turnId ||
      typeof message.attempt !== "number" || message.attempt <= 0 || !message.targetId;
  }, [cancellable, sessionId]);
  // [المهمة 4 - وضع السياق] قراءة حية من مخزن الجلسات (التبديل يعيد الرسم بلا remount):
  // session.contextMode غائب في الصفوف القديمة بالتالي stateful افتراضي ولا stateless ضمني أبدًا.
  const liveSession = useSessionsStore((s) => s.sessions.find((x) => x.id === sessionId));
  const contextMode: ContextMode = liveSession?.contextMode ?? session.contextMode ?? "stateful";
  // [المهمة 4 - المقياس = الإرسال] الهدف محل التركيز (احتياطًا: الهدف الأول) مصدر حد المقياس،
  // لا نسب مولدة من سجل المزودين ولا 128000 الافتراضي؛ غياب البيانات يظل علامة جهل صادقة.
  const focusTarget = targets.find((t) => t.targetId === focusTargetId) ?? targets[0] ?? null;
  const contextLimit: number | null = focusTarget?.modelInfo.contextLength ?? null;
  // تثبيت الأهداف المختارة في بيانات الجلسة (Dexie + القائمة المحلية): فقط عند تغيير مصفوفة الأهداف نفسها
  // (إضافة/إزالة/تلقيم بذرة) — الكتابة النصية للمؤلف تحفظ مرجع المصفوفة فلا تلمس Dexie.
  useEffect(() => {
    const capturedViewGeneration = viewGenerationRef.current;
    // المرجع: .superpowers/sdd/hardening-task-3-target-fix.md — فشل حفظ الأهداف يُبتر تاريخًا
    // ظاهريًا: تحذير عام بلا تفاصيل التخزين/المسار/المفاتيح، والأهداف تبقى محليًا في المخزن.
    setTargets(sessionId, targets).catch(() => {
      if (viewGenerationRef.current === capturedViewGeneration && useSessionsStore.getState().currentId === sessionId) {
        toast.warning("تعذر حفظ الأهداف في بيانات الجلسة — ستبقى محليًا فحسب");
      }
    });
  }, [setTargets, sessionId, targets]);
  // ديدان الاستعارة المتبقية تُهمل هنا: remount عبر key في App يضمن خلو كل مرجع متأخر من جلسة سابقة
  const aborts = useRef(new Map<string, AbortController>());
  // أهداف أوقفها المستخدم في التمرّة الجارية: نتيجة الإلغاء تصلف خطأً من dispatch
  // لكن البطاقة تبقى «أُوقف» ولا تتحول إلى خطأ ولا تُطلق تنبيهًا.
  const stopped = useRef(new Set<string>());
  // A session can be remounted with the same id (A -> B -> A). A generation token
  // prevents an old closure from mutating the newly mounted view after its cleanup.
  // Ref writes stay in effects so React's render-phase purity/lint rules are preserved.
  const viewGenerationRef = useRef(0);
  useLayoutEffect(() => {
    advanceViewGeneration(viewGenerationRef);
    return () => {
      advanceViewGeneration(viewGenerationRef);
    };
  }, [sessionId]);
  function isViewGenerationCurrent(generation: number): boolean {
    return viewGenerationRef.current === generation && useSessionsStore.getState().currentId === sessionId;
  }
  const scopedMessages = useMemo(() => messages.filter((message) => message.sessionId === sessionId), [messages, sessionId]);
  const sessionTokens = useMemo(() => estimateSessionTokens(scopedMessages), [scopedMessages]);

  const turns = useTurns(scopedMessages);

  async function doSend(): Promise<void> {
    if (sessionOperationCoordinator.isActive(sessionId)) {
      toast.warning("جارٍ تنفيذ عملية بالفعل");
      return;
    }
    // [M11] Guard against sending with no targets or empty prompt.
    if (targets.length === 0) {
      toast.warning(ar.noTargets);
      return;
    }
    const trimmedPrompt = sharedPrompt.trim();
    if (!trimmedPrompt) {
      toast.warning(ar.emptyPrompt);
      return;
    }
    const turn: Turn = { id: newId("turn"), sharedPrompt, customs: { ...customs } };
    await persistTurn(turn);
  }

  async function persistTurn(
    turn: Turn,
    retryTargetId?: string,
    baseResults?: ChatMessage[],
    assistantIds?: Record<string, string>,
  ): Promise<void> {
    const kind = retryTargetId ? "retry" : "send";
    const handle = sessionOperationCoordinator.start(sessionId, kind, new AbortController());
    if (!handle) {
      toast.warning("جارٍ تنفيذ عملية بالفعل");
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
    const publishMessageProgress = (message: ChatMessage, text = message.text, status = message.status, error = message.error): boolean => {
      if (!operationIsCurrent() || !isCanonicalAssistantMessage(message)) return false;
      const next = { ...message, text, status, error };
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
      for (const controller of targetControllers.values()) controller.abort(handle.controller.signal.reason ?? new Error("أُلغي العملية"));
    };
    handle.controller.signal.addEventListener("abort", abortTargets, { once: true });
    try {
      operationGeneration = await claimOperationLease(sessionId, opId, turn.id, operationIsCurrent);
      if (!operationIsCurrent()) return;
      if (retryTargetId) {
        const record = await getTurn(turn.id);
        if (record && record.sessionId !== sessionId) throw new Error("تعارض هوية الجلسة في سجل المحاولة");
        const result = baseResults?.[0] ?? historySnapshot.find((candidate) =>
          candidate.sessionId === sessionId && candidate.turnId === turn.id && candidate.role === "assistant" && candidate.targetId === retryTargetId,
        );
        if (record) {
          const persisted = selectPersistedRetryAttempt(record, result, retryTargetId);
          if (!persisted) throw new Error("تعذر العثور على محاولة المحفوظة لهذه البطاقة");
          const stable = buildRetryInput(persisted);
          const stableTarget = stable.targets.find((target) => target.targetId === retryTargetId);
          if (!stableTarget) throw new Error("الهدف المحفوظ لا يطابق البطاقة");
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
          ) throw new Error("بيانات المحاولة القديمة غير مكتملة ولا يمكن إعادة المحاولة بأمان");
          const promptText = shared && custom
            ? shared + "\n\n[تعليمات خاصة بهذا النموذج]\n" + custom
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
        if (!updated) throw new Error("تغيرت ملكية العملية قبل حفظ مسار الجلسة");
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
          onStatus: (callbackOperationId, targetId, status, error, callbackAttemptId, callbackTurnId, callbackMessageId) => {
            if (!acceptsCallback(callbackOperationId, callbackAttemptId, callbackTurnId ?? "", callbackMessageId)) return;
            const message = exactMessage(targetId, callbackTurnId, callbackMessageId);
            if (!message) return;
            publishMessageProgress(message, message.text, status, error);
            if (status === "error" && error && isCurrent()) toast.error(error);
          },
          onDropped: (callbackOperationId, targetIds, callbackAttemptId, callbackTurnId) => {
            if (targetIds.length && isCurrent() && acceptsOperationCallback(callbackOperationId, callbackAttemptId, callbackTurnId ?? "")) toast.warning(ar.droppedTargets + " (" + targetIds.length + ")");
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
      if (isCurrent()) toast.error(error instanceof Error ? error.message : String(error));
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
    }
  }

  function cancelCurrentOperation(message?: ChatMessage): void {
    const active = sessionOperationCoordinator.activeFor(sessionId);
    if (!active) return;
    const state = useSessionsStore.getState();
    // Global Stop may arrive before hydration; coordinator cancellation remains safe.
    // A card Stop, however, must carry and match the complete row identity.
    if (message) {
      if (!patchMessageByIdentity(message, active.id, "stopped")) return;
    } else {
      for (const row of state.messages) {
        if (row.sessionId === sessionId && row.role === "assistant" && row.operationId === active.id) {
          patchMessageByIdentity(row, active.id, "stopped");
        }
      }
    }
    sessionOperationCoordinator.cancel(sessionId);
  }

  // Keyboard shortcuts: Ctrl+Enter (send), Escape (stop streaming)
  useChatShortcuts(doSend, cancelCurrentOperation, sending);

  // Focus management: focus main content on session switch
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (mainRef.current && !document.activeElement?.closest("[data-composer]")) {
      mainRef.current.focus();
    }
  }, [sessionId]);

  // Synthesis extraction lives in its own hook; the transcript view only wires it up.
  const extractSummary = useSummaryExtraction({
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
  });

  // [المهمة 4] التبديل يُثبت صريحًا في Dexie (updateSession) وفي الحالة الحية معًا —
  // كلا الوضعين يُحفظ باسمه حتى لا يصبح stateless ضمنيًا عند إعادة فتح الجلسة.
  async function onToggleContextMode(next: ContextMode): Promise<void> {
    const capturedViewGeneration = viewGenerationRef.current;
    await updateSession(session.id, { contextMode: next });
    if (!isViewGenerationCurrent(capturedViewGeneration)) return;
    useSessionsStore.setState((s) => ({ sessions: s.sessions.map((x) => (x.id === session.id ? { ...x, contextMode: next } : x)) }));
  }

  async function onToggleLayout(): Promise<void> {
    const capturedViewGeneration = viewGenerationRef.current;
    const next = session.layoutMode === "vertical" ? "horizontal" : "vertical";
    await updateSession(session.id, { layoutMode: next });
    if (!isViewGenerationCurrent(capturedViewGeneration)) return;
    useSessionsStore.setState((s) => ({ sessions: s.sessions.map((x) => (x.id === session.id ? { ...x, layoutMode: next } : x)) }));
  }

  if (targets.length === 0 && messages.length === 0) {
    return (
      <main ref={mainRef} tabIndex={-1} className="flex-1 flex flex-col h-full min-w-0">
        <div className="flex-1 grid place-items-center text-sura-muted text-sm" role="status" aria-live="polite">أضف نماذج من (+) ثم اكتب سؤالك.</div>
        <Composer sessionId={session.id} onSend={() => void doSend()} onStop={() => { cancelCurrentOperation(); }} onExtractSummary={() => void extractSummary()} sending={sending} cancellable={cancellable} sessionTokens={sessionTokens} contextLimit={null} contextMode={contextMode} onContextModeChange={(next) => void onToggleContextMode(next)} />
      </main>
    );
  }

  return (
    <main ref={mainRef} tabIndex={-1} className="flex-1 flex flex-col h-full min-w-0">
      <div className="px-4 pt-3 flex justify-start items-center gap-2">
        <RagStatusChip onOpenSettings={onOpenSettings} />
        <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
          <Download className="size-4" />
          {ar.exportSession}
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4" dir="rtl" role="log" aria-live="polite" aria-label="الرسائل">
        {turns.map(([turnId, t]) => (
          <TurnView key={turnId} prompts={t.prompts} results={t.results} layout={session.layoutMode}
            customPrompts={t.customPrompts} onToggleLayout={() => void onToggleLayout()}
            onStop={(message) => { cancelCurrentOperation(message); }}
            disabled={sending}
            stopDisabled={stopDisabledFor}
            onRetry={(message) => {
              // Use the captured message identity, not a reusable target id, to locate its turn.
              const entry = [...turns].reverse().find(([, candidate]) =>
                candidate.results.some((result) => result.id === message.id),
              );
              const captured = entry?.[1].results.find((result) => result.id === message.id);
              const targetId = captured?.targetId;
              if (!entry || !captured || !targetId) return;
              const turn = entry[1];
              // [انحراف موثق 7/8 عن كود الخطة] إعادة المحاولة كما في الخطة تبني تمريرة بأسئلة فارغة
              // فيُسقط الهدف (buildTurnTargets) وتولّد رسالة جديدة فتتضاعف البطاقات؛ هنا نعيد
              // بناء السؤال الموحد/المخصص من رسائل تمريرة الهدف ونعيد استخدام معرف النتيجة.
              const sharedMsg = [...turn.prompts].reverse().find((p) => p.promptKind === "shared");
              const customMsg = [...turn.prompts].reverse().find((p) => p.promptKind === "custom" && p.targetId === targetId);
              void persistTurn({ id: captured.turnId, sharedPrompt: sharedMsg?.text ?? null, customs: customMsg ? { [targetId]: customMsg.text } : {} }, targetId, [captured], { [targetId]: captured.id });
            }} toolActivity={toolActivity} toolErrors={toolErrors} onToolError={(targetId) => {
              setToolErrors((prev) => {
                const next = { ...prev };
                delete next[targetId];
                return next;
              });
            }} />
        ))}
        {turns.length === 0 && <p className="text-sura-muted text-sm" role="status" aria-live="polite">لا رسائل بعد.</p>}
      </div>
      <Composer sessionId={session.id} onSend={() => void doSend()} onStop={() => { cancelCurrentOperation(); }}
        onExtractSummary={() => void extractSummary()} sending={sending} cancellable={cancellable}
        sessionTokens={sessionTokens}
        contextLimit={contextLimit}
        contextMode={contextMode}
        onContextModeChange={(next) => void onToggleContextMode(next)} />
      <SessionExportDialog open={exportOpen} onOpenChange={setExportOpen} session={session} messages={scopedMessages} />
    </main>
  );
}

function patchMessageByIdentity(message: ChatMessage, operationId: string, status: ChatMessage["status"]): boolean {
  const state = useSessionsStore.getState();
  const current = state.messages.find((candidate) => candidate.id === message.id);
  if (
    !current ||
    current.sessionId !== message.sessionId ||
    current.turnId !== message.turnId ||
    current.operationId !== operationId ||
    current.attemptId !== message.attemptId ||
    current.attempt !== message.attempt ||
    current.targetId !== message.targetId ||
    (status === "stopped" && current.status !== "pending" && current.status !== "streaming")
  ) return false;
  state.patchMessage(current.id, { status });
  return true;
}