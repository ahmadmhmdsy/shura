import { useMemo } from "react";
import type { ChatMessage } from "@/types";

export interface TurnData {
  prompts: ChatMessage[];
  results: ChatMessage[];
  customPrompts: Record<string, string>;
}

/**
 * Groups the current session's messages into turns (prompt + result rows),
 * preserving chronological order and per-target custom prompts. Pure derivation
 * over the scoped message list, memoized so the transcript only recomputes on change.
 */
export function useTurns(scopedMessages: readonly ChatMessage[]): [string, TurnData][] {
  return useMemo(() => {
    const map: Map<string, TurnData> = new Map();
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
}
