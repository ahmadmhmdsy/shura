/**
 * كتابة الرسائل مع حراسة الهوية/الحدود، وقراءة رسائل الجلسة.
 * repos/messages — extracted from the former single-file repos module.
 */

import { db } from "../db";
import { hasIdentity, hasCompleteIdentity, sameIdentity, sameCoordinates, isTerminal, sameTerminalContent } from "./identity";
import type { ChatMessage, TurnAttempt, TurnRecord } from "@/types";

export interface AppendMessageResult {
  accepted: boolean;
  current?: ChatMessage;
  reason?: "identity" | "stale" | "session" | "terminal";
}

async function operationLeaseAllows(message: ChatMessage): Promise<boolean> {
  if (!hasCompleteIdentity(message)) return true;
  const lease = await db.operation_leases.get(message.sessionId);
  if (!lease) return true;
  if (lease.operationId === message.operationId) {
    // A released lease may still receive explicit error/stopped recovery of its
    // own canceled operation, but never a late success/streaming write.
    return lease.status === "active" || message.status === "error" || message.status === "stopped";
  }
  // A replacement owns the lease now. The old operation may finalize only an
  // explicit terminal error/stopped row; it cannot create a new live row or done.
  return isTerminal(message.status) && message.status !== "done";
}


async function canonicalAttemptForMessage(turn: TurnRecord | undefined, message: ChatMessage): Promise<TurnAttempt | undefined> {
  if (!turn || !hasCompleteIdentity(message)) return undefined;
  if (turn.sessionId !== message.sessionId) return undefined;
  const attempt = turn.attempts.find((candidate) =>
    candidate.id === message.attemptId &&
    candidate.turnId === message.turnId &&
    candidate.operationId === message.operationId &&
    candidate.attempt === message.attempt,
  );
  if (!attempt) return undefined;
  const identifiedResult = message.role === "assistant" || message.kind === "result" || message.kind === "synthesis";
  if (identifiedResult && (typeof message.targetId !== "string" || message.targetId.length === 0)) return undefined;
  if (message.targetId !== undefined) {
    const target = attempt.targets.find((candidate) => candidate.targetId === message.targetId);
    if (!target) return undefined;
    if (identifiedResult && (message.providerId !== target.providerId || message.modelId !== target.modelId || !message.modelInfo)) return undefined;
    if (!identifiedResult && message.providerId !== undefined && message.providerId !== target.providerId) return undefined;
    if (!identifiedResult && message.modelId !== undefined && message.modelId !== target.modelId) return undefined;
    if (message.modelInfo !== undefined && JSON.stringify(message.modelInfo) !== JSON.stringify(target.modelInfo)) return undefined;
  }
  return attempt;
}

function isCurrentAttempt(turn: TurnRecord | undefined, attempt: TurnAttempt | undefined): boolean {
  if (!turn || !attempt || attempt.superseded) return false;
  const latest = turn.attempts.reduce<TurnAttempt | undefined>(
    (current, candidate) => current === undefined || candidate.attempt > current.attempt ? candidate : current,
    undefined,
  );
  return latest?.id === attempt.id;
}

/**
 * Append a message only when its durable identity is still admissible. The result
 * is explicit so a rejected write can never be reflected into Zustand.
 *
 * `canAppend` is an optional operation-ownership guard evaluated inside the same
 * transaction, immediately before the write. A success claim must be able to lose
 * a race with a cancellation that lands while the append is already in flight, so
 * the caller can bind the guard to the captured operation instead of the open lease.
 */
export async function appendMessage(msg: ChatMessage, canAppend?: () => boolean): Promise<AppendMessageResult> {
  return db.transaction("rw", [db.messages, db.turns, db.operation_leases, db.tombstones], async () => {
    if (canAppend && !canAppend()) return { accepted: false, reason: "stale" };
    // A tombstoned session is durably removed: a late write from an operation that
    // outlived its deletion must never recreate rows for it.
    if (await db.tombstones.get(msg.sessionId)) return { accepted: false, reason: "session" };
    if (!(await operationLeaseAllows(msg))) return { accepted: false, reason: "stale" };
    const existing = await db.messages.get(msg.id);
    const turn = msg.turnId ? await db.turns.get(msg.turnId) : undefined;
    if (turn && turn.sessionId !== msg.sessionId) return { accepted: false, reason: "session" };

    if (!existing) {
      if (hasIdentity(msg) && !hasCompleteIdentity(msg)) return { accepted: false, reason: "identity" };
      // Every new identified row must belong to a persisted TurnAttempt. Truly
      // un-identified legacy rows remain admissible so reconciliation can stop them.
      if (hasIdentity(msg)) {
        if (!turn) return { accepted: false, reason: "stale" };
        const canonical = await canonicalAttemptForMessage(turn, msg);
        if (!isCurrentAttempt(turn, canonical) || (canonical && isTerminal(canonical.status) && msg.status !== canonical.status)) {
          return { accepted: false, reason: "stale" };
        }
      }
      await db.messages.put(msg);
      return { accepted: true, current: { ...msg } };
    }

    if (existing.sessionId !== msg.sessionId) return { accepted: false, current: { ...existing }, reason: "session" };
    if (!sameCoordinates(existing, msg)) return { accepted: false, current: { ...existing }, reason: "identity" };
    const incomingIsNewAttempt = hasCompleteIdentity(msg) && (
      !hasIdentity(existing) ||
      (hasCompleteIdentity(existing) && (msg.attempt ?? 0) > (existing.attempt ?? 0))
    );
    const sameStoredIdentity = hasCompleteIdentity(existing) && hasCompleteIdentity(msg) && sameIdentity(existing, msg);
    if (sameStoredIdentity) {
      const canonical = await canonicalAttemptForMessage(turn, msg);
      if (canonical && isTerminal(canonical.status) && canonical.status !== msg.status) {
        return { accepted: false, current: { ...existing }, reason: "stale" };
      }
    }
    if (isTerminal(existing.status) && !isTerminal(msg.status) && !incomingIsNewAttempt) {
      return { accepted: false, current: { ...existing }, reason: "terminal" };
    }
    if (isTerminal(existing.status) && isTerminal(msg.status) && !incomingIsNewAttempt && !sameTerminalContent(existing, msg)) {
      return { accepted: false, current: { ...existing }, reason: "terminal" };
    }
    if (isTerminal(existing.status) && isTerminal(msg.status) && existing.status !== msg.status && !incomingIsNewAttempt) {
      return { accepted: false, current: { ...existing }, reason: "terminal" };
    }
    if (
      isTerminal(existing.status) &&
      isTerminal(msg.status) &&
      hasCompleteIdentity(existing) &&
      hasCompleteIdentity(msg) &&
      sameIdentity(existing, msg) &&
      !sameTerminalContent(existing, msg)
    ) {
      return { accepted: false, current: { ...existing }, reason: "terminal" };
    }

    if (hasIdentity(existing)) {
      if (!hasCompleteIdentity(existing) || !hasCompleteIdentity(msg)) return { accepted: false, current: { ...existing }, reason: "identity" };
      if (!sameIdentity(existing, msg)) {
        if ((msg.attempt ?? 0) <= (existing.attempt ?? 0)) return { accepted: false, current: { ...existing }, reason: "stale" };
        const canonical = await canonicalAttemptForMessage(turn, msg);
        if (!isCurrentAttempt(turn, canonical) || (canonical && isTerminal(canonical.status) && msg.status !== canonical.status)) {
          return { accepted: false, current: { ...existing }, reason: "stale" };
        }
      } else if (turn) {
        const canonical = await canonicalAttemptForMessage(turn, msg);
        if (!canonical || (!isCurrentAttempt(turn, canonical) && !isTerminal(msg.status)) || (isTerminal(canonical.status) && msg.status !== canonical.status)) {
          return { accepted: false, current: { ...existing }, reason: "stale" };
        }
      } else {
        return { accepted: false, current: { ...existing }, reason: "stale" };
      }
    } else if (hasIdentity(msg)) {
      if (!hasCompleteIdentity(msg)) return { accepted: false, current: { ...existing }, reason: "identity" };
      const canonical = await canonicalAttemptForMessage(turn, msg);
      if (!isCurrentAttempt(turn, canonical)) return { accepted: false, current: { ...existing }, reason: "stale" };
    }

    const next = {
      ...msg,
      ...(existing.superseded && !incomingIsNewAttempt ? { superseded: true } : {}),
      ...(existing.sidecarWarning !== undefined && msg.sidecarWarning === undefined && !incomingIsNewAttempt
        ? { sidecarWarning: existing.sidecarWarning }
        : {}),
    };
    if (canAppend && !canAppend()) return { accepted: false, current: { ...existing }, reason: "stale" };
    await db.messages.put(next);
    return { accepted: true, current: { ...next } };
  });
}

export async function getMessages(sessionId: string): Promise<ChatMessage[]> {
  return db.messages.where("sessionId").equals(sessionId).sortBy("createdAt");
}
