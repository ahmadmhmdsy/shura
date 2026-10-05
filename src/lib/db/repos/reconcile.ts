/**
 * خط بدء التشغيل: تحويل الصفوف المعلّقة بلا عملية حية إلى «متوقفة» بلا حذف.
 * repos/reconcile — extracted from the former single-file repos module.
 */

import { db } from "../db";
import { liveOperationKey } from "@/lib/operationIdentity";
import { INTERRUPTED_TURN_ERROR } from "./attempts";
import { cloneTurn } from "./clone";
import type { ChatMessage, TurnAttempt, TurnStatus } from "@/types";

function groupKey(sessionId: string, turnId: string): string {
  return sessionId + "\u0000" + turnId;
}

/**
 * Startup seam: turn pending/streaming rows with no live operation become stopped.
 * Text and operation identity are retained; no rows are deleted or reset. Groups
 * use (sessionId, turnId), never turnId alone, so identical ids cannot cross-talk.
 */
export async function reconcileInterruptedTurns(liveOperationIds: ReadonlySet<string> = new Set()): Promise<number> {
  return db.transaction("rw", [db.turns, db.messages], async () => {
    const turns = await db.turns.toArray();
    const messages = await db.messages.toArray();
    const byGroup = new Map<string, ChatMessage[]>();
    for (const message of messages) {
      const key = groupKey(message.sessionId, message.turnId);
      const rows = byGroup.get(key) ?? [];
      rows.push(message);
      byGroup.set(key, rows);
    }
    let changed = 0;
    for (const stored of turns) {
      const turn = cloneTurn(stored);
      const rows = byGroup.get(groupKey(turn.sessionId, turn.id)) ?? [];
      let turnChanged = false;
      const activeAttempt = (attempt: TurnAttempt): boolean =>
        !attempt.superseded && (attempt.status === "streaming" || attempt.status === "pending");
      let hasLiveAttempt = false;
      for (const attempt of turn.attempts) {
        if (attempt.superseded && (attempt.status === "streaming" || attempt.status === "pending")) {
          attempt.status = "stopped";
          turnChanged = true;
          continue;
        }
        if (!activeAttempt(attempt)) continue;
        if (attempt.operationId && liveOperationIds.has(liveOperationKey(turn.sessionId, attempt.operationId))) {
          hasLiveAttempt = true;
          continue;
        }
        attempt.status = "stopped";
        turnChanged = true;
      }
      let hasLiveMessage = false;
      const terminalAttemptStatus = (status: TurnStatus): boolean =>
        status === "done" || status === "error" || status === "stopped";
      const matchingAttempt = (row: ChatMessage): TurnAttempt | undefined => {
        if (!row.operationId || !row.attemptId || typeof row.attempt !== "number") return undefined;
        return turn.attempts.find((attempt) =>
          attempt.id === row.attemptId &&
          attempt.turnId === row.turnId &&
          attempt.operationId === row.operationId &&
          attempt.attempt === row.attempt,
        );
      };
      for (const row of rows) {
        if (row.status !== "streaming" && row.status !== "pending") continue;
        if (row.superseded) {
          row.status = "stopped";
          row.error = INTERRUPTED_TURN_ERROR;
          await db.messages.put(row);
          turnChanged = true;
          continue;
        }
        const attempt = matchingAttempt(row);
        if (attempt && !attempt.superseded && terminalAttemptStatus(attempt.status)) {
          // Recover a nonterminal primary from the exact terminal attempt when
          // only the final message append failed.
          row.status = attempt.status;
          if (row.status === "error" && !row.error) row.error = "تعذر حفظ النتيجة الأساسية";
          if (row.status === "stopped" && !row.error) row.error = INTERRUPTED_TURN_ERROR;
          await db.messages.put(row);
          turnChanged = true;
          continue;
        }
        const completeMessageIdentity =
          typeof row.operationId === "string" && row.operationId.length > 0 &&
          typeof row.attemptId === "string" && row.attemptId.length > 0 &&
          typeof row.attempt === "number" && Number.isInteger(row.attempt) && row.attempt > 0;
        const identityCanBeLive = completeMessageIdentity && (attempt !== undefined || turn.attempts.length === 0);
        if (identityCanBeLive && liveOperationIds.has(liveOperationKey(turn.sessionId, row.operationId!))) {
          hasLiveMessage = true;
          continue;
        }
        row.status = "stopped";
        row.error = INTERRUPTED_TURN_ERROR;
        await db.messages.put(row);
        turnChanged = true;
      }
      const activeTurn = turn.status === "streaming" || turn.status === "pending";
      if (hasLiveAttempt || hasLiveMessage) {
        if (turn.status !== "streaming") {
          turn.status = "streaming";
          turnChanged = true;
        }
      } else if (activeTurn) {
        const currentAttempts = turn.attempts.filter((attempt) => !attempt.superseded);
        const allTerminal = currentAttempts.length > 0 && currentAttempts.every((attempt) => terminalAttemptStatus(attempt.status));
        turn.status = allTerminal
          ? currentAttempts.some((attempt) => attempt.status === "error")
            ? "error"
            : currentAttempts.every((attempt) => attempt.status === "stopped")
              ? "stopped"
              : "done"
          : "stopped";
        turnChanged = true;
      }
      if (turnChanged) {
        await db.turns.put(turn);
        changed += 1;
      }
    }

    const turnKeys = new Set(turns.map((turn) => groupKey(turn.sessionId, turn.id)));
    for (const [key, rows] of byGroup) {
      if (turnKeys.has(key)) continue;
      let groupChanged = false;
      for (const row of rows) {
        if (row.status !== "streaming" && row.status !== "pending") continue;
        row.status = "stopped";
        row.error = INTERRUPTED_TURN_ERROR;
        await db.messages.put(row);
        groupChanged = true;
      }
      if (groupChanged) changed += 1;
    }
    return changed;
  });
}
