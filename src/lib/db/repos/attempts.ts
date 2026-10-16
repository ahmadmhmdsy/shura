/**
 * محاولات التمرّر: الحفظ، التجاوز، الحالة النهائية، واختيار محاولة إعادة المحاولة.
 * repos/attempts — extracted from the former single-file repos module.
 */

import { db } from "../db";
import { hasCompleteIdentity, isTerminal } from "./identity";
import { cloneAttempt, cloneTurn } from "./clone";
import type { ChatMessage, ContextMode, TurnAttempt, TurnRecord, TurnStatus } from "@/types";

export const INTERRUPTED_TURN_ERROR = "توقفت العملية قبل اكتمالها";

function sameSnapshot(left: TurnAttempt, right: TurnAttempt): boolean {
  return left.turnId === right.turnId &&
    left.kind === right.kind &&
    left.createdAt === right.createdAt &&
    left.operationId === right.operationId &&
    left.status === right.status &&
    left.superseded === right.superseded &&
    JSON.stringify(left.targets) === JSON.stringify(right.targets);
}

/**
 * Persist an immutable attempt before any provider or placeholder side effect.
 * The caller may provide a synchronous ownership guard; it is checked inside the
 * transaction as well as before the write to close cancellation windows.
 */
export async function persistTurnAttempt(
  sessionId: string,
  turnId: string,
  attempt: TurnAttempt,
  contextMode: ContextMode,
  sharedPrompt: string | null,
  canCreate: () => boolean,
  expectedOperationGeneration?: number,
): Promise<TurnAttempt> {
  if (attempt.turnId !== turnId) throw new Error("persistTurnAttempt: turn identity mismatch");
  return db.transaction("rw", [db.turns, db.operation_leases], async () => {
    if (!canCreate()) throw new Error("persistTurnAttempt: operation is no longer current");
    if (expectedOperationGeneration !== undefined) {
      const lease = await db.operation_leases.get(sessionId);
      if (!lease || lease.operationId !== attempt.operationId || lease.turnId !== turnId || lease.generation !== expectedOperationGeneration || lease.status !== "active") {
        throw new Error("persistTurnAttempt: durable operation generation is no longer current");
      }
    }
    const current = await db.turns.get(turnId);
    if (current && current.sessionId !== sessionId) throw new Error("persistTurnAttempt: session identity mismatch");
    const previous = (current?.attempts ?? []).map(cloneAttempt);
    const existingAttempt = previous.find((candidate) => candidate.id === attempt.id);
    if (existingAttempt) {
      if (!sameSnapshot(existingAttempt, attempt)) throw new Error("persistTurnAttempt: conflicting attempt replay");
      return cloneAttempt(existingAttempt);
    }
    const nextAttemptNumber = Math.max(0, ...previous.map((candidate) => candidate.attempt)) + 1;
    const canonical: TurnAttempt = { ...cloneAttempt(attempt), attempt: nextAttemptNumber };
    const attempts = [...previous, canonical].sort((left, right) => left.attempt - right.attempt);
    const next: TurnRecord = {
      id: turnId,
      sessionId,
      createdAt: current?.createdAt ?? canonical.createdAt,
      status: canonical.status,
      contextMode: current?.contextMode ?? contextMode,
      sharedPrompt: current?.sharedPrompt ?? sharedPrompt,
      attempts,
    };
    if (!canCreate()) throw new Error("persistTurnAttempt: operation is no longer current");
    if (expectedOperationGeneration !== undefined) {
      const lease = await db.operation_leases.get(sessionId);
      if (!lease || lease.operationId !== attempt.operationId || lease.turnId !== turnId || lease.generation !== expectedOperationGeneration || lease.status !== "active") {
        throw new Error("persistTurnAttempt: durable operation generation is no longer current");
      }
    }
    await db.turns.put(next);
    // Re-check after the awaited write: cancellation or a replacement lease can
    // arrive while IndexedDB is committing. Throwing here rolls the transaction back.
    if (!canCreate()) throw new Error("persistTurnAttempt: operation is no longer current");
    if (expectedOperationGeneration !== undefined) {
      const lease = await db.operation_leases.get(sessionId);
      if (!lease || lease.operationId !== attempt.operationId || lease.turnId !== turnId || lease.generation !== expectedOperationGeneration || lease.status !== "active") {
        throw new Error("persistTurnAttempt: durable operation generation is no longer current");
      }
    }
    return cloneAttempt(canonical);
  });
}

export function selectPersistedRetryAttempt(
  record: TurnRecord | undefined,
  result: ChatMessage | undefined,
  targetId: string,
): TurnAttempt | undefined {
  if (!record) return undefined;
  if (!result || result.sessionId !== record.sessionId || result.turnId !== record.id) {
    throw new Error("تعارض هوية المحاولة المحفوظة");
  }
  const hasAnyIdentity = result.operationId !== undefined || result.attemptId !== undefined || result.attempt !== undefined;
  if (!hasAnyIdentity) {
    // A legacy backfill recorded the exact message it was created from. That explicit
    // association is the only admissible source here; anything else would be guessing
    // which historical attempt an unidentified row belongs to.
    const backfilled = record.attempts.find((candidate) =>
      candidate.sourceMessageId === result.id && !candidate.superseded,
    );
    if (backfilled) return verifiedRetryAttempt(backfilled, result, targetId);
    // A TurnRecord is the durable source of truth. Do not guess which
    // historical attempt an unidentified row belongs to: that could retry a
    // different operation after a replacement.
    throw new Error("لا يمكن تحديد المحاولة المحفوظة للهوية الناقصة");
  }
  if (!hasCompleteIdentity(result)) throw new Error("تعذر تحديد المحاولة المحفوظة للهوية الناقصة");
  const attempt = record.attempts.find((candidate) =>
    candidate.id === result.attemptId &&
    candidate.turnId === result.turnId &&
    candidate.operationId === result.operationId &&
    candidate.attempt === result.attempt,
  );
  if (!attempt || attempt.superseded) throw new Error("المحاولة المحفوظة غير صالحة لإعادة المحاولة");
  return verifiedRetryAttempt(attempt, result, targetId);
}

/** Target/provider/model identity is re-verified for every retry source, legacy or not. */
function verifiedRetryAttempt(attempt: TurnAttempt, result: ChatMessage, targetId: string): TurnAttempt {
  const target = attempt.targets.find((candidate) => candidate.targetId === targetId);
  if (!target || result.targetId !== targetId || result.providerId !== target.providerId || result.modelId !== target.modelId || !result.modelInfo) {
    throw new Error("إحداثيات نتيجة إعادة المحاولة لا تطابق السجل المحفوظ");
  }
  if (JSON.stringify(result.modelInfo) !== JSON.stringify(target.modelInfo)) {
    throw new Error("معلومات النموذج لا تطابق السجل المحفوظ");
  }
  return cloneAttempt(attempt);
}

/** Mark old attempts only after the caller has durably written the replacement placeholder. */
export async function supersedeTurnAttempts(turnId: string, attemptIds: readonly string[]): Promise<boolean> {
  if (attemptIds.length === 0) return true;
  const ids = new Set(attemptIds);
  return db.transaction("rw", [db.turns, db.messages], async () => {
    const stored = await db.turns.get(turnId);
    if (!stored) return false;
    const turn = cloneTurn(stored);
    const present = turn.attempts.filter((attempt) => ids.has(attempt.id));
    if (present.length !== ids.size) return false;
    turn.attempts = turn.attempts.map((attempt) => ids.has(attempt.id) ? { ...attempt, superseded: true } : attempt);
    await db.turns.put(turn);
    const rows = await db.messages.where("sessionId").equals(turn.sessionId).toArray();
    const attemptsById = new Map(present.map((attempt) => [attempt.id, attempt]));
    for (const row of rows) {
      if (!row.attemptId || !ids.has(row.attemptId) || row.turnId !== turn.id) continue;
      const attempt = attemptsById.get(row.attemptId);
      if (!attempt || row.operationId !== attempt.operationId || row.attempt !== attempt.attempt) continue;
      await db.messages.put({ ...row, superseded: true });
    }
    return turn.attempts.filter((attempt) => ids.has(attempt.id)).every((attempt) => attempt.superseded === true);
  });
}

export async function updateTurnAttemptStatus(turnId: string, attemptId: string, status: TurnStatus, operationId?: string): Promise<boolean> {
  return db.transaction("rw", db.turns, async () => {
    const stored = await db.turns.get(turnId);
    if (!stored) return false;
    const current = stored.attempts.find((attempt) => attempt.id === attemptId);
    if (!current) return false;
    if (!operationId || current.operationId !== operationId) return false;
    const terminal = isTerminal(status);
    if (current.superseded && !terminal) return false;
    if (isTerminal(current.status)) {
      if (!terminal || current.status !== status) return false;
    }
    const latest = stored.attempts.reduce((a, b) => (b.attempt > a.attempt ? b : a), stored.attempts[0]);
    // An older exact operation may publish its terminal attempt state, but it
    // must not change the aggregate turn after a newer attempt exists.
    const nextStatus = latest && latest.id === current.id ? status : stored.status;
    const attempts = stored.attempts.map((attempt) => attempt.id === attemptId ? { ...attempt, status } : attempt);
    await db.turns.put({ ...stored, status: nextStatus, attempts });
    return true;
  });
}
