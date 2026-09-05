import { create } from "zustand";
import type { ChatMessage, SessionMeta } from "@/types";
import { appendMessage, createSession, deleteSession, getMessages, listSessions, updateSession } from "@/lib/db/repos";
import { newId } from "@/lib/id";

interface SessionsState {
  sessions: SessionMeta[]; currentId: string | null; messages: ChatMessage[];
  load(): Promise<void>;
  newSession(): Promise<SessionMeta>;
  open(id: string): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  remove(id: string): Promise<void>;
  appendMessageLocal(msg: ChatMessage): Promise<void>;
  /** رفع رسائل إلى القائمة المحلية بلا كتابة Dexie (chatController يكتب Dexie ويعكس هنا) */
  upsertMessagesLocal(msgs: ChatMessage[]): void;
  patchMessage(id: string, patch: Partial<ChatMessage>): void;
  clearCurrent(): void;
}

export const useSessionsStore = create<SessionsState>((set) => ({
  sessions: [], currentId: null, messages: [],
  async load() { set({ sessions: await listSessions() }); },
  async newSession() {
    const meta: SessionMeta = { id: newId("s"), title: "جلسة جديدة", createdAt: Date.now(), updatedAt: Date.now(), modelIds: [], primaryTarget: null, layoutMode: "vertical", onDisk: false };
    await createSession(meta);
    set((s) => ({ sessions: [meta, ...s.sessions], currentId: meta.id, messages: [] }));
    return meta;
  },
  async open(id) { set({ currentId: id, messages: await getMessages(id) }); },
  async rename(id, title) { await updateSession(id, { title }); set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, title } : x)) })); },
  async remove(id) {
    await deleteSession(id);
    set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id), currentId: s.currentId === id ? null : s.currentId, messages: s.currentId === id ? [] : s.messages }));
  },
  async appendMessageLocal(msg) { await appendMessage(msg); set((s) => ({ messages: [...s.messages, msg] })); },
  upsertMessagesLocal(msgs) {
    set((s) => {
      const byId = new Map(s.messages.map((m) => [m.id, m]));
      for (const m of msgs) byId.set(m.id, m);
      return { messages: [...byId.values()] };
    });
  },
  patchMessage(id, patch) { set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) })); },
  clearCurrent() { set({ currentId: null, messages: [] }); },
}));
