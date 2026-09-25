import { create } from "zustand";
import type { ChatMessage, SessionMeta, TargetConfig } from "@/types";
import { appendMessage, createSession, getMessages, getSession, listSessions, updateSession } from "@/lib/db/repos";
import { deleteSessionDurably, type DeleteSessionResult } from "@/lib/sessionDeletion";
import { getFileSink, isFilePersistActive } from "@/lib/markdown/sink";
import { useSettingsStore } from "./settingsStore";
import type { AppendMessageResult } from "@/lib/db/repos";
import { newId } from "@/lib/id";
import { sessionOperationCoordinator } from "@/lib/chat/operationCoordinator";
import { useComposerStore } from "./composerStore";

// المرجع: .superpowers/sdd/hardening-task-3-brief.md الخطوة 4 — حجب الحمولة القديمة حسب الجيل.
// كل عملية تفتح/تسمّي/تحذف جلسة تُزايد الجيل تزامنيًا عند بدئها، وأي التزام متأخر
// (حمولة getMessages أو استدعاء محلي) لا يلتفت إلا إذا بقي الجيل والهوية مالكيه.

interface SessionsState {
  sessions: SessionMeta[]; currentId: string | null; messages: ChatMessage[];
  /** جارٍ تحميل رسائل الجلسة المفتوحة */
  loading: boolean;
  /** جيل عملية load()؛ يُزاد تزامنيًا عند بدئها لاحتواء التحميلات المتنافسة */
  loadGeneration: number;
  /** جيل عمليات open/newSession/remove؛ يُزاد تزامنيًا عند بدء كل عملية */
  openGeneration: number;
  load(): Promise<void>;
  newSession(): Promise<SessionMeta>;
  open(id: string): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  remove(id: string): Promise<DeleteSessionResult>;
  /** تثبيت بيانات الأهداف المختارة في بيانات جلسة (Dexie + القائمة المحلية)؛ يُتجاهل إن لم يتغير شيء */
  setTargets(id: string, targets: TargetConfig[]): Promise<void>;
  appendMessageLocal(msg: ChatMessage, canPublish?: () => boolean): Promise<AppendMessageResult>;
  /** رفع رسائل إلى القائمة المحلية بلا كتابة Dexie (chatController يكتب Dexie ويعكس هنا) */
  upsertMessagesLocal(msgs: ChatMessage[], options?: { allowNewerAttempt?: boolean; canPublish?: () => boolean }): void;
  patchMessage(id: string, patch: Partial<ChatMessage>): void;
  clearCurrent(): void;
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  sessions: [], currentId: null, messages: [], loading: false, loadGeneration: 0, openGeneration: 0,
  async load() {
    const gen = get().loadGeneration + 1;
    set({ loadGeneration: gen, loading: true });
    try {
      const sessions = await listSessions();
      if (get().loadGeneration !== gen) return;
      set({ sessions, loading: false });
    } finally {
      // رفض الطلب الحالي يستحق رفع الحاجب؛ الطلب العتيق (تجاوزه جيل أحدث) لا يلمس الحاجب
      if (get().loadGeneration === gen && get().loading) set({ loading: false });
    }
  },
  async newSession() {
    const gen = get().openGeneration + 1;
    set({ openGeneration: gen });
    const meta: SessionMeta = { id: newId("s"), title: "جلسة جديدة", createdAt: Date.now(), updatedAt: Date.now(), modelIds: [], primaryTarget: null, layoutMode: "vertical", onDisk: false };
    await createSession(meta);
    // الجلسة أُنشئت في Dexie مطلقًا (لا للتراجع)؛ لكن التبديل إليها يلتفت للجيل فقط
    if (get().openGeneration !== gen) return meta;
    set((s) => ({ sessions: [meta, ...s.sessions], currentId: meta.id, messages: [] }));
    return meta;
  },
  async open(id) {
    const gen = get().openGeneration + 1;
    set({ openGeneration: gen, currentId: id, messages: [], loading: true });
    // تلقيم أهداف الجلسة المحفوظة في مسودتها عند أول فتح: إن كتب المستخدم مسودة قبل هذا التسلسل
    // (مسودة قائمة فعلًا) فهي أحدث قيمة ولا تُستبدل بالبذرة.
    const meta = get().sessions.find((x) => (x.id === id));
    if (meta?.targets?.length && !(id in useComposerStore.getState().drafts)) {
      useComposerStore.getState().setDraft(id, { targets: meta.targets });
    }
    try {
      const msgs = await getMessages(id);
      // التثبيت يقتضي بقاء الجيل والهوية المطلوبين — حمولة سباقة خسرت السباق تُرمى
      if (get().openGeneration !== gen || get().currentId !== id) return;
      set({ messages: msgs, loading: false });
    } finally {
      // رفض هذا الفتح يرفع الحاجب إن كان ما زال صاحب الجيل والهوية؛
      // فتح عتيق (تجاوزه جيل/جلسة أحدث) لا يلمس الحاجب ولا رسائل الطلب الأحدث
      if (get().openGeneration === gen && get().currentId === id && get().loading) set({ loading: false });
    }
  },
  async rename(id, title) { await updateSession(id, { title }); set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, title } : x)) })); },
  async remove(id) {
    const gen = get().openGeneration + 1;
    set({ openGeneration: gen });
    // A live operation must stop and drain before deletion. Its durable finalizers
    // write messages/usage/turns, so deleting first would let a late write recreate
    // rows for a session the user just removed.
    if (sessionOperationCoordinator.isActive(id)) {
      sessionOperationCoordinator.cancel(id);
      await sessionOperationCoordinator.waitForIdle(id);
    }
    // The live row is the deletion payload: its onDiskDir is the only safe archive path.
    const target = get().sessions.find((session) => session.id === id) ?? await getSession(id);
    if (!target) throw new Error("لا توجد جلسة بهذا المعرّف للحذف");
    // Durable deletion: the disk witness, then the database transaction, then the
    // archive bytes. A rejection leaves the session, its draft, and its archive intact.
    const result = await deleteSessionDurably(
      target,
      isFilePersistActive() ? getFileSink() : null,
      useSettingsStore.getState().sessionRootDir ?? "sessions",
    );
    // The draft is cleared only after a successful durable delete: a rejected removal
    // must leave the session and its draft intact and recoverable.
    useComposerStore.getState().clearSession(id);
    if (get().openGeneration !== gen) return result;
    set((s) => ({ sessions: s.sessions.filter((x) => (x.id !== id)), currentId: s.currentId === id ? null : s.currentId, messages: s.currentId === id ? [] : s.messages }));
    return result;
  },
  // المرجع: .superpowers/sdd/hardening-task-3-target-fix.md — عقد async قابل للرصد:
  // تحديث تفاؤلي للقائمة المحلية فورًا، وعند فشل updateSession تراجع فقط إن بقيت القيمة الحية
  // هي القيمة المجرَّبة نفسها (فرفض طلب قديم لا يطغى على اختيار أهداف أحدث)، ثم إعادة رمي الفشل.
  async setTargets(id, targets) {
    // مقارنة قيمية: نفس الأهداف (اقتباسًا أعاد ChatScreen رصد التغيير) لا تثير كتابة Dexie صامتة تُزيح updatedAt
    const cur = get().sessions.find((x) => (x.id === id))?.targets;
    if (JSON.stringify(cur) === JSON.stringify(targets)) return;
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, targets } : x)) }));
    try {
      await updateSession(id, { targets });
    } catch (e) {
      set((s) => ({
        sessions: s.sessions.map((x) => {
          // التراجع مسموح فقط إن بقيت القيمة الحية هي القيمة المجرَّبة للطلب الفاشل
          if (x.id !== id || JSON.stringify(x.targets) !== JSON.stringify(targets)) return x;
          if (cur === undefined) { const rest = { ...x }; delete rest.targets; return rest; }
          return { ...x, targets: cur };
        }),
      }));
      throw e;
    }
  },
  // الكتابة في Dexie دائمًا (بيانات الجلسة منشورة)؛ الانعكاس في القائمة المحلية فقط إذا ظل أصحابها مفتوحين
  async appendMessageLocal(msg, canPublish) {
    const result = await appendMessage(msg);
    if (!result.accepted) return result;
    const stored = result.current ?? msg;
    if (canPublish && !canPublish()) return { ...result, current: stored };
    set((s) => {
      if (s.currentId !== msg.sessionId) return {};
      const byId = new Map(s.messages.map((row) => [row.id, row]));
      byId.set(stored.id, stored);
      return { messages: [...byId.values()] };
    });
    return { ...result, current: stored };
  },
  upsertMessagesLocal(msgs, options = {}) {
    if (options.canPublish && !options.canPublish()) return;
    set((s) => {
      const open = msgs.filter((m) => m.sessionId === s.currentId);
      const byId = new Map(s.messages.map((m) => [m.id, m]));
      let changed = false;
      for (const m of open) {
        const existing = byId.get(m.id);
        if (!existing) {
          byId.set(m.id, m);
          changed = true;
          continue;
        }
        const stableKeys = ["id", "sessionId", "turnId", "createdAt", "role", "kind", "promptKind", "targetId", "providerId", "modelId"] as const;
        if (stableKeys.some((key) => existing[key] !== m[key])) continue;
        if (JSON.stringify(existing.modelInfo) !== JSON.stringify(m.modelInfo)) continue;
        const completeIdentity = (value: ChatMessage): boolean =>
          typeof value.operationId === "string" && value.operationId.length > 0 &&
          typeof value.attemptId === "string" && value.attemptId.length > 0 &&
          typeof value.attempt === "number" && Number.isInteger(value.attempt) && value.attempt > 0;
        const hasAnyIdentity = (value: ChatMessage): boolean =>
          Boolean(value.operationId || value.attemptId || value.attempt !== undefined);
        const incomingHasAnyIdentity = hasAnyIdentity(m);
        const existingHasAnyIdentity = hasAnyIdentity(existing);
        const incomingIdentity = completeIdentity(m);
        const existingIdentity = completeIdentity(existing);
        const sameIdentity = incomingIdentity && existingIdentity &&
          existing.operationId === m.operationId && existing.attemptId === m.attemptId && existing.attempt === m.attempt;
        const newerAttempt = options.allowNewerAttempt === true && incomingIdentity &&
          (existing.attempt ?? 0) < (m.attempt ?? 0);
        if (incomingHasAnyIdentity && !incomingIdentity) continue;
        if (existingHasAnyIdentity && !existingIdentity) continue;
        if (incomingIdentity && !existingIdentity) {
          if (!newerAttempt) continue;
        } else if ((existingIdentity || incomingIdentity) && !sameIdentity && !newerAttempt) {
          continue;
        }
        if (existingIdentity && !incomingIdentity) continue;
        const existingTerminal = existing.status === "done" || existing.status === "error" || existing.status === "stopped";
        if (existingTerminal && existing.status !== m.status && !newerAttempt) continue;
        const current = byId.get(m.id);
        const sameStoredIdentity = current?.operationId === m.operationId && current?.attemptId === m.attemptId && current?.attempt === m.attempt;
        const next = existing.superseded && !newerAttempt ? { ...m, superseded: true } : m;
        const sameContent = current?.text === next.text && current?.status === next.status && current?.error === next.error &&
          current?.sidecarWarning === next.sidecarWarning && current?.superseded === next.superseded && JSON.stringify(current?.usage) === JSON.stringify(next.usage);
        if (sameStoredIdentity && sameContent) continue;
        byId.set(m.id, next);
        changed = true;
      }
      return changed ? { messages: [...byId.values()] } : s;
    });
  },
  patchMessage(id, patch) {
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== id || m.sessionId !== s.currentId) return m;
        const terminal = m.status === "done" || m.status === "error" || m.status === "stopped";
        if (terminal && patch.status !== undefined && patch.status !== m.status) return m;
        const immutableKeys = ["id", "sessionId", "turnId", "createdAt", "role", "kind", "promptKind", "targetId", "providerId", "modelId", "operationId", "attemptId", "attempt"] as const;
        for (const key of immutableKeys) {
          if (Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== m[key]) return m;
        }
        if (Object.prototype.hasOwnProperty.call(patch, "modelInfo") && JSON.stringify(patch.modelInfo) !== JSON.stringify(m.modelInfo)) return m;
        return { ...m, ...patch };
      }),
    }));
  },
  clearCurrent() { set({ currentId: null, messages: [] }); },
}));
