import { create } from "zustand";
import type { TargetConfig } from "@/types";
import { newId } from "@/lib/id";
import { LIMITS } from "@/lib/limits";

/** مسودة المؤلف كاملة لجلسة واحدة: كل أعمدتها افتراضية فلا تجويف لأشكال ناقصة (عقد المرجع حرفيًا). */
export interface ComposerDraft {
  targets: TargetConfig[];
  syncMode: boolean;
  sharedPrompt: string;
  customs: Record<string, string>;
  focusTargetId: string | null;
  agentMode: boolean;
}

export interface ComposerState {
  /** مسودات مفهرسة بمعرف الجلسة: مفتاح لكل جلسة، ولا سبيل لقراءة مسودة جلسة أخرى. */
  drafts: Record<string, ComposerDraft>;
  /** مسودة الجلسة المطلوبة؛ للجلسة المجهولة كائن فارغ جديد في كل نداء (لا كتابة في المخزن ولا نسخ من مسودة أخرى). */
  getDraft(sessionId: string): ComposerDraft;
  /** دمج جزئي على القاعدة الفارغة داخل مسودة الجلسة المحددة حصرًا. */
  setDraft(sessionId: string, patch: Partial<ComposerDraft>): void;
  addTarget(sessionId: string, target: Omit<TargetConfig, "targetId">): void;
  removeTarget(sessionId: string, targetId: string): void;
  setShared(sessionId: string, text: string): void;
  setCustom(sessionId: string, targetId: string, text: string): void;
  setSyncMode(sessionId: string, value: boolean): void;
  setFocus(sessionId: string, targetId: string | null): void;
  setAgentMode(sessionId: string, value: boolean): void;
  /** حذف مسودة الجلسة بالكامل (تستدعيه إزالة الجلسة في مخزن الجلسات). */
  clearSession(sessionId: string): void;
}

/** مسودة فارغة مرجعية للقراءة: مكوّنات الواجهة تستخدمها بديلًا عن مسودة الجلسة المجهولة. */
export function emptyComposerDraft(): ComposerDraft {
  return { targets: [], syncMode: true, sharedPrompt: "", customs: {}, focusTargetId: null, agentMode: false };
}

/** Stable read-only fallback for selectors; getDraft intentionally keeps its historical fresh-object API. */
export const EMPTY_COMPOSER_DRAFT: ComposerDraft = emptyComposerDraft();

function withoutKey(record: Record<string, string>, key: string): Record<string, string> {
  const { [key]: _drop, ...rest } = record;
  void _drop;
  return rest;
}

export const useComposerStore = create<ComposerState>((set, get) => ({
  drafts: {},
  getDraft(sessionId) {
    const d = get().drafts[sessionId];
    return d ?? emptyComposerDraft();
  },
  setDraft(sessionId, patch) {
    set((s) => ({ drafts: { ...s.drafts, [sessionId]: { ...emptyComposerDraft(), ...s.drafts[sessionId], ...patch } } }));
  },
  addTarget(sessionId, target) {
    set((s) => {
      const d = s.drafts[sessionId] ?? emptyComposerDraft();
      return { drafts: { ...s.drafts, [sessionId]: { ...d, targets: [...d.targets, { ...target, targetId: newId("tgt") }] } } };
    });
  },
  removeTarget(sessionId, targetId) {
    set((s) => {
      const d = s.drafts[sessionId];
      if (!d) return {};
      return { drafts: { ...s.drafts, [sessionId]: { ...d,
        targets: d.targets.filter((t) => t.targetId !== targetId),
        customs: withoutKey(d.customs, targetId),
        focusTargetId: d.focusTargetId === targetId ? null : d.focusTargetId,
      } } };
    });
  },
  setShared(sessionId, text) {
    set((s) => ({ drafts: { ...s.drafts, [sessionId]: { ...(s.drafts[sessionId] ?? emptyComposerDraft()), sharedPrompt: text.slice(0, LIMITS.sharedPromptMax) } } }));
  },
  setCustom(sessionId, targetId, text) {
    set((s) => ({ drafts: { ...s.drafts, [sessionId]: {
      ...(s.drafts[sessionId] ?? emptyComposerDraft()),
      customs: { ...(s.drafts[sessionId]?.customs ?? {}), [targetId]: text.slice(0, LIMITS.customPromptMax) },
    } } }));
  },
  setSyncMode(sessionId, value) {
    set((s) => ({ drafts: { ...s.drafts, [sessionId]: { ...(s.drafts[sessionId] ?? emptyComposerDraft()), syncMode: value, focusTargetId: null } } }));
  },
  setFocus(sessionId, targetId) {
    set((s) => ({ drafts: { ...s.drafts, [sessionId]: { ...(s.drafts[sessionId] ?? emptyComposerDraft()), focusTargetId: targetId } } }));
  },
  setAgentMode(sessionId, value) {
    set((s) => ({ drafts: { ...s.drafts, [sessionId]: { ...(s.drafts[sessionId] ?? emptyComposerDraft()), agentMode: value } } }));
  },
  clearSession(sessionId) {
    set((s) => {
      if (!(sessionId in s.drafts)) return {};
      const { [sessionId]: _drop, ...rest } = s.drafts;
      void _drop;
      return { drafts: rest };
    });
  },
}));