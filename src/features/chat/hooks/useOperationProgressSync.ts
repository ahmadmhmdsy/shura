import { useEffect } from "react";
import { useSessionsStore } from "@/state/sessionsStore";
import { sessionOperationCoordinator, type OperationProgress } from "@/lib/chat/operationCoordinator";
import type { ChatMessage } from "@/types";

/**
 * Hydrates the live message list from the operation coordinator's buffered
 * progress. An open/reopen payload is authoritative; after close only a terminal
 * snapshot is safe to apply. Identity and generation guards prevent a delayed
 * snapshot from reviving an older generation after a remount.
 */
export function useOperationProgressSync(
  sessionId: string,
  sessionLoading: boolean,
  operationProgress: readonly OperationProgress[],
  upsertMessagesLocal: (msgs: ChatMessage[], options?: { allowNewerAttempt?: boolean; canPublish?: () => boolean }) => void,
): void {
  useEffect(() => {
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
  }, [operationProgress, sessionId, sessionLoading, upsertMessagesLocal]);
}
