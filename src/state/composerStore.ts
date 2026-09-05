import { create } from "zustand";
import type { ProviderId } from "@/types";
import { newId } from "@/lib/id";

export interface ComposerTarget { targetId: string; providerId: ProviderId; modelId: string; }

interface ComposerState {
  targets: ComposerTarget[]; syncMode: boolean; sharedPrompt: string; customs: Record<string, string>; focusTargetId: string | null;
  addTarget(t: Omit<ComposerTarget, "targetId">): void;
  removeTarget(targetId: string): void;
  setShared(text: string): void;
  setCustom(targetId: string, text: string): void;
  setSyncMode(v: boolean): void;
  setFocus(targetId: string | null): void;
  loadForSession(targets: ComposerTarget[]): void;
  reset(): void;
}

export const useComposerStore = create<ComposerState>((set) => ({
  targets: [], syncMode: true, sharedPrompt: "", customs: {}, focusTargetId: null,
  addTarget(t) { const targetId = newId("tgt"); set((s) => ({ targets: [...s.targets, { ...t, targetId }] })); },
  removeTarget(targetId) { set((s) => ({ targets: s.targets.filter((t) => t.targetId !== targetId), customs: Object.fromEntries(Object.entries(s.customs).filter(([k]) => k !== targetId)), focusTargetId: s.focusTargetId === targetId ? null : s.focusTargetId })); },
  setShared(text) { set({ sharedPrompt: text }); },
  setCustom(targetId, text) { set((s) => ({ customs: { ...s.customs, [targetId]: text } })); },
  setSyncMode(v) { set({ syncMode: v, focusTargetId: v ? null : null }); },
  setFocus(targetId) { set({ focusTargetId: targetId }); },
  loadForSession(targets) { set({ targets, customs: {}, sharedPrompt: "", focusTargetId: null }); },
  reset() { set({ targets: [], syncMode: true, sharedPrompt: "", customs: {}, focusTargetId: null }); },
}));
