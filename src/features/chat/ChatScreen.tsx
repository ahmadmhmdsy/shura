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
import { persistTurn, type PersistTurnDeps } from "./persistTurn";
import { RagStatusChip } from "@/features/rag/RagStatusChip";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { useSessionsStore } from "@/state/sessionsStore";
import { useComposerStore, EMPTY_COMPOSER_DRAFT } from "@/state/composerStore";
import { useSettingsStore } from "@/state/settingsStore";
import { estimateSessionTokens } from "@/lib/tokens/estimate";
import { resolveContextLimit } from "@/lib/chat/contextLimit";
import { sessionOperationCoordinator } from "@/lib/chat/operationCoordinator";
import { newId } from "@/lib/id";
import { updateSession } from "@/lib/db/repos";
import { useUiText } from "@/i18n";
import type { ChatMessage, ContextMode, SessionMeta, Turn } from "@/types";

function advanceViewGeneration(ref: { current: number }): void {
  ref.current += 1;
}

export function ChatScreen({ session, onOpenSettings, autoFocusComposer = true }: { session: SessionMeta; onOpenSettings(): void; autoFocusComposer?: boolean }) {
  // الربط الموقّع: كل القراءات والأكشنات تحمل معرف الجلسة نفسه — لا سطح مؤلف شامل بعد الخطوة 5
  const sessionId = session.id;
  const { t, plural } = useUiText();
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
  const setShared = useComposerStore((s) => s.setShared);
  const clearCustoms = useComposerStore((s) => s.clearCustoms);
  const clearCustomsOnSend = useSettingsStore((s) => s.clearCustomsOnSend);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
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
  // [T2.5/NL-02] المقياس = البوابة: حد واحد من resolveContextLimit للهدف محل التركيز (احتياطًا:
  // الهدف الأول). غياب الهدف كليًا يبقى علامة جهل، أما نموذج بلا حد منشور فيُعرض له الحد المفترض
  // نفسه الذي تفرضه البوابة مع علامة افتراض ظاهرة.
  const focusTarget = targets.find((t) => t.targetId === focusTargetId) ?? targets[0] ?? null;
  const resolvedLimit = focusTarget ? resolveContextLimit(focusTarget.modelInfo) : null;
  const contextLimit: number | null = resolvedLimit?.limit ?? null;
  const contextAssumed = resolvedLimit?.assumed ?? false;
  // تثبيت الأهداف المختارة في بيانات الجلسة (Dexie + القائمة المحلية): فقط عند تغيير مصفوفة الأهداف نفسها
  // (إضافة/إزالة/تلقيم بذرة) — الكتابة النصية للمؤلف تحفظ مرجع المصفوفة فلا تلمس Dexie.
  useEffect(() => {
    const capturedViewGeneration = viewGenerationRef.current;
    // المرجع: .superpowers/sdd/hardening-task-3-target-fix.md — فشل حفظ الأهداف يُبتر تاريخًا
    // ظاهريًا: تحذير عام بلا تفاصيل التخزين/المسار/المفاتيح، والأهداف تبقى محليًا في المخزن.
    setTargets(sessionId, targets).catch(() => {
      if (viewGenerationRef.current === capturedViewGeneration && useSessionsStore.getState().currentId === sessionId) {
        toast.warning(t("chat.targetsPersistFailed"));
      }
    });
  }, [setTargets, sessionId, targets, t]);
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

  // [T4.1] كل ما تقرأه persistTurn من نطاق المكوّن يمرّ عبر هذا الكائن الصريح.
  function turnDeps(): PersistTurnDeps {
    return {
      session, sessionId, t, plural, targets, syncMode, providerKeys, timeoutMs,
      contextMode, multiStepTools, upsertMessagesLocal, setToolErrors, setToolActivity,
      aborts, stopped, viewGenerationRef,
    };
  }

  async function doSend(): Promise<void> {
    if (sessionOperationCoordinator.isActive(sessionId)) {
      toast.warning(t("chat.operationInProgress"));
      return;
    }
    // [M11] Guard against sending with no targets or empty prompt.
    if (targets.length === 0) {
      toast.warning(t("chat.noTargets"));
      return;
    }
    // وضع الربط يرسل السؤال الموحد للجميع، فلا معنى للإرسال بلا سؤال موحد. أمّا مع إيقافه
    // فيكفي سؤال مخصص واحد — وهو ما يقبله buildTurnTargets أصلًا في الفرع غير الموحد.
    const trimmedPrompt = sharedPrompt.trim();
    const hasCustomPrompt = targets.some((target) => (customs[target.targetId] ?? "").trim().length > 0);
    if (!trimmedPrompt && (syncMode || !hasCustomPrompt)) {
      toast.warning(t("chat.emptyPrompt"));
      return;
    }
    const turn: Turn = { id: newId("turn"), sharedPrompt, customs: { ...customs } };
    // الإفراغ وإرجاع التركيز لا يتوقفان على نجاح الإرسال: نص الرسالة محفوظ في التمريرة أصلًا.
    setShared(sessionId, "");
    // Opt-in: the per-target prompts are a deliberate setup, so they are wiped only when the
    // user asked for it in Settings. The shared question always clears.
    if (clearCustomsOnSend) clearCustoms(sessionId);
    composerInputRef.current?.focus();
    await persistTurn(turnDeps(), turn);
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

  // Focus management on session switch. ChatScreen is keyed by session id in App, so mounting
  // *is* switching: the draft is per-session and therefore empty again, which makes the composer
  // the right place for the caret. App withholds autoFocusComposer while the modal onboarding
  // dialog owns focus, and then <main> takes it exactly as before.
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (autoFocusComposer && composerInputRef.current) {
      composerInputRef.current.focus();
      return;
    }
    if (mainRef.current && !document.activeElement?.closest("[data-composer]")) {
      mainRef.current.focus();
    }
  }, [sessionId, autoFocusComposer]);

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
        <div className="flex-1 grid place-items-center text-sura-muted text-sm" role="status" aria-live="polite">{t("chat.addTargetsPrompt")}</div>
        <Composer ref={composerInputRef} sessionId={session.id} onSend={() => void doSend()} onStop={() => { cancelCurrentOperation(); }} onExtractSummary={() => void extractSummary()} sending={sending} cancellable={cancellable} sessionTokens={sessionTokens} contextLimit={null} contextMode={contextMode} onContextModeChange={(next) => void onToggleContextMode(next)} />
      </main>
    );
  }

  return (
    <main ref={mainRef} tabIndex={-1} className="flex-1 flex flex-col h-full min-w-0">
      <div className="px-4 pt-3 flex justify-start items-center gap-2">
        <RagStatusChip onOpenSettings={onOpenSettings} />
        <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
          <Download className="size-4" />
          {t("exportDialog.session")}
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4" role="log" aria-live="polite" aria-label={t("chat.messages")}>
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
              void persistTurn(turnDeps(), { id: captured.turnId, sharedPrompt: sharedMsg?.text ?? null, customs: customMsg ? { [targetId]: customMsg.text } : {} }, targetId, [captured], { [targetId]: captured.id });
            }} toolActivity={toolActivity} toolErrors={toolErrors} onToolError={(targetId) => {
              setToolErrors((prev) => {
                const next = { ...prev };
                delete next[targetId];
                return next;
              });
            }} />
        ))}
        {turns.length === 0 && <p className="text-sura-muted text-sm" role="status" aria-live="polite">{t("chat.noMessages")}</p>}
      </div>
      <Composer ref={composerInputRef} sessionId={session.id} onSend={() => void doSend()} onStop={() => { cancelCurrentOperation(); }}
        onExtractSummary={() => void extractSummary()} sending={sending} cancellable={cancellable}
        sessionTokens={sessionTokens}
        contextLimit={contextLimit}
        contextAssumed={contextAssumed}
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