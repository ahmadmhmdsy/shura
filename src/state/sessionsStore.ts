import { create } from "zustand";
import type { ChatMessage, SessionMeta, TargetConfig } from "@/types";
import { appendMessage, createSession, deleteSession, getMessages, listSessions, updateSession } from "@/lib/db/repos";
import { newId } from "@/lib/id";
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
  remove(id: string): Promise<void>;
  /** تثبيت بيانات الأهداف المختارة في بيانات جلسة (Dexie + القائمة المحلية)؛ يُتجاهل إن لم يتغير شيء */
  setTargets(id: string, targets: TargetConfig[]): Promise<void>;
  appendMessageLocal(msg: ChatMessage): Promise<void>;
  /** رفع رسائل إلى القائمة المحلية بلا كتابة Dexie (chatController يكتب Dexie ويعكس هنا) */
  upsertMessagesLocal(msgs: ChatMessage[]): void;
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
    // مسودة الجلسة المحذوفة تُمسح فورًا؛ لا سبيل لعودتها بعد الحذف
    useComposerStore.getState().clearSession(id);
    await deleteSession(id);
    if (get().openGeneration !== gen) return;
    set((s) => ({ sessions: s.sessions.filter((x) => (x.id !== id)), currentId: s.currentId === id ? null : s.currentId, messages: s.currentId === id ? [] : s.messages }));
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
          if (cur === undefined) { const { targets: _t, ...rest } = x; return { ...rest }; }
          return { ...x, targets: cur };
        }),
      }));
      throw e;
    }
  },
  // الكتابة في Dexie دائمًا (بيانات الجلسة منشورة)؛ الانعكاس في القائمة المحلية فقط إذا ظل أصحابها مفتوحين
  async appendMessageLocal(msg) {
    await appendMessage(msg);
    set((s) => (s.currentId === msg.sessionId ? { messages: [...s.messages, msg] } : {}));
  },
  upsertMessagesLocal(msgs) {
    set((s) => {
      const open = msgs.filter((m) => m.sessionId === s.currentId);
      const byId = new Map(s.messages.map((m) => [m.id, m]));
      for (const m of open) byId.set(m.id, m);
      return { messages: [...byId.values()] };
    });
  },
  patchMessage(id, patch) {
    set((s) => ({ messages: s.messages.map((m) => (m.id === id && m.sessionId === s.currentId ? { ...m, ...patch } : m)) }));
  },
  clearCurrent() { set({ currentId: null, messages: [] }); },
}));
