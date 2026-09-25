import { db } from "./db";
import { liveOperationKey } from "@/lib/operationIdentity";
import type { ChatMessage, ContextMode, OperationLease, SessionMeta, TargetSnapshot, TurnAttempt, TurnRecord, TurnStatus, UsageEvent } from "@/types";

export async function claimOperationLease(
  sessionId: string,
  operationId: string,
  turnId: string,
  canCreate: () => boolean,
): Promise<number> {
  return db.transaction("rw", db.operation_leases, async () => {
    if (!canCreate()) throw new Error("claimOperationLease: operation is no longer current");
    const current = await db.operation_leases.get(sessionId);
    if (current?.operationId === operationId && current.status === "active") {
      if (current.turnId !== turnId) throw new Error("claimOperationLease: operation is bound to another turn");
      return current.generation;
    }
    if (current?.operationId === operationId && (current.status === "cancelled" || current.status === "finished")) {
      throw new Error("claimOperationLease: operation lease is terminal");
    }
    const generation = (current?.generation ?? 0) + 1;
    if (!canCreate()) throw new Error("claimOperationLease: operation is no longer current");
    const lease: OperationLease = { sessionId, operationId, turnId, generation, status: "active", updatedAt: Date.now() };
    await db.operation_leases.put(lease);
    return generation;
  });
}

export async function getOperationLease(sessionId: string): Promise<OperationLease | undefined> {
  return db.operation_leases.get(sessionId);
}

export async function releaseOperationLease(
  sessionId: string,
  operationId: string,
  status: Extract<OperationLease["status"], "finished" | "cancelled">,
): Promise<boolean> {
  return db.transaction("rw", db.operation_leases, async () => {
    const current = await db.operation_leases.get(sessionId);
    if (!current || current.operationId !== operationId || current.status !== "active") return false;
    await db.operation_leases.put({ ...current, status, updatedAt: Date.now() });
    return true;
  });
}

export async function createSession(meta: SessionMeta): Promise<void> { await db.sessions.put(meta); }

export async function listSessions(): Promise<SessionMeta[]> {
  return db.sessions.orderBy("updatedAt").reverse().toArray();
}

export async function getSession(id: string): Promise<SessionMeta | undefined> { return db.sessions.get(id); }

export async function updateSession(id: string, patch: Partial<SessionMeta>): Promise<void> {
  await db.sessions.update(id, { ...patch, updatedAt: Date.now() });
}

export async function updateSessionIfOperation(
  sessionId: string,
  operationId: string,
  patch: Partial<SessionMeta>,
  canUpdate?: () => boolean,
): Promise<boolean> {
  return db.transaction("rw", [db.sessions, db.operation_leases], async () => {
    if (canUpdate && !canUpdate()) return false;
    const lease = await db.operation_leases.get(sessionId);
    if (!lease || lease.operationId !== operationId || lease.status !== "active") return false;
    if (canUpdate && !canUpdate()) return false;
    await db.sessions.update(sessionId, { ...patch, updatedAt: Date.now() });
    if (canUpdate && !canUpdate()) throw new Error("updateSessionIfOperation: operation ownership changed");
    return true;
  });
}

/**
 * Legacy deletion entry point. It must behave exactly like deleteSessionData so a
 * removed session keeps a tombstone and no late write can recreate its rows.
 */
export async function deleteSession(id: string): Promise<void> {
  await deleteSessionData(id);
}

export type ImportSessionResult = "imported" | "tombstoned";

/** حذف كامل بيانات جلسة مع كتابة شاهد حذف (tombstone) في معاملة واحدة */
export async function deleteSessionData(id: string): Promise<void> {
  await db.transaction("rw", [db.sessions, db.messages, db.usage_events, db.turns, db.tombstones, db.operation_leases], async () => {
    await db.tombstones.put({ id, deletedAt: Date.now() });
    await db.sessions.delete(id);
    await db.messages.where("sessionId").equals(id).delete();
    await db.usage_events.where("sessionId").equals(id).delete();
    await db.turns.where("sessionId").equals(id).delete();
    await db.operation_leases.delete(id);
  });
}

export async function hasTombstone(id: string): Promise<boolean> {
  return (await db.tombstones.get(id)) !== undefined;
}

async function assertTurnIdAvailable(turn: TurnRecord): Promise<void> {
  const existing = await db.turns.get(turn.id);
  if (existing && existing.sessionId !== turn.sessionId) {
    throw new Error(`TurnRecord id collision: ${turn.id} is owned by session ${existing.sessionId}`);
  }
}

export async function putTurn(turn: TurnRecord): Promise<void> {
  await db.transaction("rw", db.turns, async () => {
    await assertTurnIdAvailable(turn);
    await db.turns.put(turn);
  });
}

/** TurnRecord.id remains a global key; use getTurns(sessionId) for session-scoped listing. */
export async function getTurn(id: string): Promise<TurnRecord | undefined> {
  return db.turns.get(id);
}

export async function getTurns(sessionId: string): Promise<TurnRecord[]> {
  return db.turns.where("sessionId").equals(sessionId).sortBy("createdAt");
}

/** استيراد جلسة كاملة ذريًا: يفحص شاهد الحذف داخل نفس المعاملة قبل كتابة أي صف */
export async function importSessionAtomically(
  meta: SessionMeta,
  messages: ChatMessage[],
  turns: TurnRecord[],
  usageEvents: UsageEvent[],
): Promise<ImportSessionResult> {
  return db.transaction("rw", [db.sessions, db.messages, db.usage_events, db.turns, db.tombstones, db.operation_leases], async () => {
    if (await db.tombstones.get(meta.id)) return "tombstoned";
    const lease = await db.operation_leases.get(meta.id);
    if (lease?.status === "active") throw new Error("importSessionAtomically: active operation lease");
    await db.operation_leases.delete(meta.id);
    await db.sessions.put(meta);
    for (const m of messages) {
      if (m.sessionId !== meta.id) throw new Error("importSessionAtomically: foreign message " + m.id);
      await db.messages.put(m);
    }
    for (const t of turns) {
      if (t.sessionId !== meta.id) throw new Error("importSessionAtomically: foreign turn " + t.id);
      await assertTurnIdAvailable(t);
      await db.turns.put(t);
    }
    for (const e of usageEvents) {
      if (e.sessionId !== meta.id) throw new Error("importSessionAtomically: foreign usage event " + e.id);
      await db.usage_events.put(e);
    }
    return "imported";
  });
}

export interface AppendMessageResult {
  accepted: boolean;
  current?: ChatMessage;
  reason?: "identity" | "stale" | "session" | "terminal";
}

function hasIdentity(message: ChatMessage): boolean {
  return Boolean(message.operationId || message.attemptId || message.attempt !== undefined);
}

function hasCompleteIdentity(message: ChatMessage): message is ChatMessage & { operationId: string; attemptId: string; attempt: number } {
  return typeof message.operationId === "string" && message.operationId.length > 0 &&
    typeof message.attemptId === "string" && message.attemptId.length > 0 &&
    typeof message.attempt === "number" && Number.isInteger(message.attempt) && message.attempt > 0 &&
    typeof message.turnId === "string" && message.turnId.length > 0;
}

function sameIdentity(left: ChatMessage, right: ChatMessage): boolean {
  return left.sessionId === right.sessionId && left.turnId === right.turnId &&
    left.operationId === right.operationId && left.attemptId === right.attemptId && left.attempt === right.attempt;
}

function sameCoordinates(left: ChatMessage, right: ChatMessage): boolean {
  const stableKeys = ["turnId", "createdAt", "role", "kind", "promptKind", "targetId", "providerId", "modelId"] as const;
  if (stableKeys.some((key) => left[key] !== right[key])) return false;
  if (left.modelInfo !== undefined || right.modelInfo !== undefined) {
    if (!left.modelInfo || !right.modelInfo || JSON.stringify(left.modelInfo) !== JSON.stringify(right.modelInfo)) return false;
  }
  return true;
}

function isTerminal(status: ChatMessage["status"]): boolean {
  return status === "done" || status === "error" || status === "stopped";
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

function sameUsage(left: ChatMessage["usage"], right: ChatMessage["usage"]): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.inputTokens === right.inputTokens &&
    left.outputTokens === right.outputTokens &&
    left.cachedInputTokens === right.cachedInputTokens &&
    (left.cacheWriteInputTokens ?? 0) === (right.cacheWriteInputTokens ?? 0) &&
    left.costUSD === right.costUSD;
}

function sameTerminalContent(left: ChatMessage, right: ChatMessage): boolean {
  return left.text === right.text && left.error === right.error && sameUsage(left.usage, right.usage);
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

export async function recordUsage(ev: UsageEvent): Promise<void> {
  // Deletion is durable: a sidecar that outlives its session is reported, never stored.
  if (await hasTombstone(ev.sessionId)) throw new Error("تعذر حفظ الاستهلاك: الجلسة محذوفة");
  await db.usage_events.put(ev);
}

export async function getUsageEvents(filter?: { sessionId?: string; providerId?: string; fromTs?: number }): Promise<UsageEvent[]> {
  const narrow = (list: UsageEvent[]): UsageEvent[] => list.filter((e) => (filter?.providerId ? e.providerId === filter.providerId : true));
  if (filter?.sessionId) {
    const list = await db.usage_events.where("sessionId").equals(filter.sessionId).sortBy("ts");
    return narrow(list).filter((e) => (filter.fromTs ? e.ts >= filter.fromTs : true));
  }
  if (filter?.fromTs) {
    const list = await db.usage_events.where("ts").aboveOrEqual(filter.fromTs).toArray();
    return narrow(list);
  }
  return narrow(await db.usage_events.orderBy("ts").toArray());
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const row = await db.settings.get(key);
  return row?.value as T | undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> { await db.settings.put({ key, value }); }

export const INTERRUPTED_TURN_ERROR = "توقفت العملية قبل اكتمالها";

function cloneTarget(target: TargetSnapshot): TargetSnapshot {
  return {
    ...target,
    modelInfo: {
      ...target.modelInfo,
      pricing: target.modelInfo.pricing ? { ...target.modelInfo.pricing } : target.modelInfo.pricing,
    },
  };
}

function cloneAttempt(attempt: TurnAttempt): TurnAttempt {
  return { ...attempt, targets: attempt.targets.map(cloneTarget) };
}

function cloneTurn(turn: TurnRecord): TurnRecord {
  return { ...turn, attempts: turn.attempts.map(cloneAttempt) };
}

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
    const terminal = status === "done" || status === "error" || status === "stopped";
    if (current.superseded && !terminal) return false;
    if (current.status === "done" || current.status === "error" || current.status === "stopped") {
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
