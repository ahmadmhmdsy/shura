import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useShallow } from "zustand/react/shallow";
import { toast } from "sonner";
import { Composer } from "./Composer";
import { TurnView } from "./TurnView";
import { useSessionsStore } from "@/state/sessionsStore";
import { useComposerStore, EMPTY_COMPOSER_DRAFT } from "@/state/composerStore";
import { useSettingsStore } from "@/state/settingsStore";
import { estimateSessionTokens } from "@/lib/tokens/estimate";
import { sendTurn } from "@/lib/chat/chatController";
import { sessionOperationCoordinator, buildRetryInput } from "@/lib/chat/operationCoordinator";
import { dispatchTurn } from "@/lib/chat/dispatch";
import { buildSummaryPrompt, buildSummaryTargetSnapshot } from "@/lib/chat/synthesis";
import { newId } from "@/lib/id";
import { appendMessage, claimOperationLease, getTurn, persistTurnAttempt, recordUsage, releaseOperationLease, selectPersistedRetryAttempt, updateSession, updateSessionIfOperation, updateTurnAttemptStatus } from "@/lib/db/repos";
import { getFileSink, isFilePersistActive } from "@/lib/markdown/sink";
import { appendTurn, sessionFolderName } from "@/lib/markdown/writer";
import { headersFor } from "@/lib/providers/registry";
import { ar } from "@/i18n/ar";
import type { ChatMessage, ContextMode, SessionMeta, Turn } from "@/types";

function advanceViewGeneration(ref: { current: number }): void {
  ref.current += 1;
}

export function ChatScreen({ session }: { session: SessionMeta }) {
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
  const settings = useSettingsStore();
  const subscribeOperations = useCallback((listener: () => void) => sessionOperationCoordinator.subscribe(listener), []);
  const operationSnapshot = useCallback(() => sessionOperationCoordinator.getVersion(), []);
  const operationVersion = useSyncExternalStore(subscribeOperations, operationSnapshot, () => 0);
  const operationActive = sessionOperationCoordinator.isActive(sessionId);
  const operationProgress = useMemo(() => {
    // operationVersion is the coordinator's reactive invalidation token; consume it
    // explicitly so a remount/open rehydrates the latest progress snapshot.
    return operationVersion >= 0 ? sessionOperationCoordinator.progressFor(sessionId) : [];
  }, [sessionId, operationVersion]);
  useEffect(() => {
    // An open/reopen payload is authoritative. Keep coordinator progress buffered
    // until it finishes, then apply the latest exact identity over that snapshot.
    if (sessionLoading || useSessionsStore.getState().currentId !== sessionId) return;
    const state = useSessionsStore.getState();
    for (const progress of operationProgress) {
      // A replacement start removes the old progress map. Requiring the latest
      // tombstone here also protects a delayed terminal snapshot from reviving an
      // older generation after a remount.
      if (!sessionOperationCoordinator.isLatestOperation(progress.operationId, sessionId)) continue;
      const message = progress.message;
      if (
        message.id !== progress.messageId ||
        message.sessionId !== progress.sessionId ||
        message.turnId !== progress.turnId ||
        message.operationId !== progress.operationId ||
        message.attemptId !== progress.attemptId ||
        message.targetId !== progress.targetId ||
        message.role !== "assistant" ||
        (message.kind !== "result" && message.kind !== "synthesis")
      ) continue;
      const current = state.messages.find((candidate) => candidate.id === progress.messageId);
      if (current && (
        current.sessionId !== progress.sessionId ||
        current.turnId !== progress.turnId ||
        current.operationId !== progress.operationId ||
        current.attemptId !== progress.attemptId ||
        current.attempt !== message.attempt ||
        current.targetId !== progress.targetId ||
        current.role !== message.role ||
        current.kind !== message.kind
      )) continue;
      const currentTerminal = current && (current.status === "done" || current.status === "error" || current.status === "stopped");
      if (currentTerminal && (progress.status === "pending" || progress.status === "streaming")) continue;
      // While the operation is open, a progress row may be the first row visible
      // after a remount. After close, only a terminal snapshot is safe to hydrate.
      if (!current) {
        const open = sessionOperationCoordinator.isOperationOpen(progress.operationId, sessionId);
        const terminal = progress.status === "done" || progress.status === "error" || progress.status === "stopped";
        if (!open && !terminal) continue;
      }
      const next = { ...message, text: progress.text, status: progress.status, error: progress.error };
      try { state.upsertMessagesLocal([next], { allowNewerAttempt: true, canPublish: () => useSessionsStore.getState().currentId === sessionId && sessionOperationCoordinator.isLatestOperation(progress.operationId, sessionId) }); } catch { /* live observer failure must not strand coordination */ }
    }
  }, [operationProgress, sessionId, sessionLoading, upsertMessagesLocal, messages]);
  const sending = operationActive;
  const activeOperation = sessionOperationCoordinator.activeFor(sessionId);
  const hasLivePrimary = Boolean(activeOperation && messages.some((message) =>
    message.sessionId === sessionId && message.role === "assistant" &&
    message.operationId === activeOperation.id && (message.status === "pending" || message.status === "streaming")));
  const hasLiveProgress = operationProgress.some((progress) => progress.status === "pending" || progress.status === "streaming");
  // Before hydration the coordinator is the only trustworthy owner; after a terminal primary,
  // progress has no live entries so sidecar-only work is intentionally not cancellable.
  const cancellable = Boolean(operationActive && (hasLivePrimary || hasLiveProgress || operationProgress.length === 0));
  const stopDisabledFor = (message: ChatMessage): boolean => {
    const active = sessionOperationCoordinator.activeFor(sessionId);
    if (!active || !cancellable) return true;
    return message.sessionId !== sessionId || message.role !== "assistant" || message.status !== "streaming" ||
      message.operationId !== active.id || !message.attemptId || !message.turnId ||
      typeof message.attempt !== "number" || message.attempt <= 0 || !message.targetId;
  };
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

  const turns = useMemo(() => {
    const map: Map<string, { prompts: ChatMessage[]; results: ChatMessage[]; customPrompts: Record<string, string> }> = new Map();
    for (const m of scopedMessages) {
      const t = map.get(m.turnId) ?? { prompts: [], results: [], customPrompts: {} };
      if (m.role === "user") {
        t.prompts.push(m);
        if (m.promptKind === "custom" && m.targetId && !m.superseded) t.customPrompts[m.targetId] = m.text;
      } else {
        t.results.push(m);
      }
      map.set(m.turnId, t);
    }
    return [...map.entries()];
  }, [scopedMessages]);

  async function doSend(): Promise<void> {
    if (sessionOperationCoordinator.isActive(sessionId)) {
      toast.warning("جارٍ تنفيذ عملية بالفعل");
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
    const opId = handle.id;
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
          historyFor: () => historySnapshot,
          modelInfoFor: (targetId) => sourceAttempt?.targets.find((target) => target.targetId === targetId)?.modelInfo ?? targets.find((target) => target.targetId === targetId)?.modelInfo ?? { id: targetId, label: targetId },
          apiKeyFor: (providerId) => settings.providerKeys[providerId] ?? "",
          sessionHeaderFor: (providerId) => headersFor(providerId, session.id),
          externalSignalFor: () => handle.controller.signal,
          timeoutMs: settings.timeoutMs,
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
          onAppended: (message) => {
            if (acceptsOperationCallback(message.operationId ?? "", message.attemptId ?? "", message.turnId) && isCanonicalAssistantMessage(message)) {
              currentAttemptNumber = message.attempt;
              publishMessageProgress(message, message.text, message.status, message.error);
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
    const primary = settings.primaryTarget ?? (targets[0] ? { providerId: targets[0].providerId, modelId: targets[0].modelId } : null);
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
          apiKeyFor: (providerId) => settings.providerKeys[providerId] ?? "",
          sessionHeaderFor: (providerId) => headersFor(providerId, session.id),
          timeoutMs: settings.timeoutMs,
          contextMode,
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
      <main className="flex-1 flex flex-col h-full min-w-0">
        <div className="flex-1 grid place-items-center text-sura-muted text-sm">أضف نماذج من (+) ثم اكتب سؤالك.</div>
        <Composer sessionId={session.id} onSend={() => void doSend()} onStop={() => { cancelCurrentOperation(); }} onExtractSummary={() => void extractSummary()} sending={sending} cancellable={cancellable} sessionTokens={sessionTokens} contextLimit={null} contextMode={contextMode} onContextModeChange={(next) => void onToggleContextMode(next)} />
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col h-full min-w-0">
      <div className="flex-1 overflow-y-auto p-4 space-y-4" dir="rtl">
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
            }} />
        ))}
        {turns.length === 0 && <p className="text-sura-muted text-sm">لا رسائل بعد.</p>}
      </div>
      <Composer sessionId={session.id} onSend={() => void doSend()} onStop={() => { cancelCurrentOperation(); }}
        onExtractSummary={() => void extractSummary()} sending={sending} cancellable={cancellable}
        sessionTokens={sessionTokens}
        contextLimit={contextLimit}
        contextMode={contextMode}
        onContextModeChange={(next) => void onToggleContextMode(next)} />
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