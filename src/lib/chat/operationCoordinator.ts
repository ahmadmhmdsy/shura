import { newId } from "@/lib/id";
import { liveOperationKey } from "@/lib/operationIdentity";
import type { ChatMessage, TargetSnapshot, TurnAttempt } from "@/types";

export type OperationKind = "send" | "retry" | "summary";

export interface OperationHandle {
  id: string;
  sessionId: string;
  kind: OperationKind;
  controller: AbortController;
}

type Listener = () => void;

function cloneChatMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    modelInfo: message.modelInfo ? { ...message.modelInfo, pricing: message.modelInfo.pricing ? { ...message.modelInfo.pricing } : message.modelInfo.pricing } : undefined,
    usage: message.usage ? { ...message.usage } : undefined,
  };
}

function cloneProgress(entry: OperationProgress): OperationProgress {
  return { ...entry, message: cloneChatMessage(entry.message) };
}

export interface OperationProgress {
  sessionId: string;
  operationId: string;
  attemptId: string;
  turnId: string;
  messageId: string;
  targetId: string;
  text: string;
  status: "pending" | "streaming" | "done" | "error" | "stopped";
  error?: string;
  message: ChatMessage;
}

export class SessionOperationCoordinator {
  private readonly active = new Map<string, OperationHandle>();
  // The latest id is a tombstone, not an active lease: cancel/finish release the
  // active slot, while a later start permanently supersedes the old identity.
  private readonly latest = new Map<string, string>();
  private readonly progress = new Map<string, Map<string, OperationProgress>>();
  // Active ownership is released immediately on cancel, but its async owner may
  // still be unwinding durable finalizers. Tests and lifecycle callers use these
  // promises to wait for that exact work instead of guessing with a timer.
  private readonly pending = new Map<string, {
    sessionId: string;
    operationId: string;
    promise: Promise<void>;
    resolve: () => void;
  }>();
  private readonly closed = new Set<string>();
  /** Upper bound on retained closed keys; see noteClosed for the eviction contract. */
  private static readonly CLOSED_TOMBSTONE_LIMIT = 200;
  private readonly listeners = new Set<Listener>();
  private version = 0;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try { listener(); } catch { /* a UI observer cannot break coordination */ }
    }
  }

  start(sessionId: string, kind: OperationKind, controller: AbortController): OperationHandle | null {
    if (this.active.has(sessionId)) return null;
    const handle: OperationHandle = { id: newId("op"), sessionId, kind, controller };
    this.active.set(sessionId, handle);
    const key = liveOperationKey(handle.sessionId, handle.id);
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    this.pending.set(key, { sessionId, operationId: handle.id, promise, resolve });
    this.closed.delete(key);
    // Only start creates a new generation/tombstone. Cancellation and completion
    // must never make an old operation current again. Progress from the old
    // generation is no longer visible once this start publishes the new latest id.
    const previousLatest = this.latest.get(sessionId);
    if (previousLatest) this.progress.delete(this.progressKey(sessionId, previousLatest));
    this.latest.set(sessionId, handle.id);
    this.progress.set(this.progressKey(sessionId, handle.id), new Map());
    this.bump();
    return handle;
  }

  activeFor(sessionId: string): OperationHandle | null {
    return this.active.get(sessionId) ?? null;
  }

  isActive(sessionId: string): boolean {
    return this.active.has(sessionId);
  }

  /**
   * Diagnostic/test visibility only. These are raw operation ids WITHOUT the session
   * component, so they must never be handed to reconcileInterruptedTurns, which expects
   * composite live keys. Use activeOperationKeys() for any reconciliation input.
   */
  activeOperationIds(): string[] {
    return [...this.active.values()].map((handle) => handle.id);
  }

  /** Composite session-scoped keys: the only admissible reconciliation input. */
  activeOperationKeys(): string[] {
    return [...this.active.values()].map((handle) => liveOperationKey(handle.sessionId, handle.id));
  }

  pendingOperationIds(sessionId?: string): string[] {
    return [...this.pending.values()]
      .filter((operation) => sessionId === undefined || operation.sessionId === sessionId)
      .map((operation) => operation.operationId);
  }

  async waitForIdle(sessionId?: string): Promise<void> {
    // Repeat after each batch so a replacement started while an older canceled
    // operation unwinds is also included in the same lifecycle boundary.
    while (true) {
      const waiting = [...this.pending.values()]
        .filter((operation) => sessionId === undefined || operation.sessionId === sessionId)
        .map((operation) => operation.promise);
      if (waiting.length === 0) return;
      await Promise.all(waiting);
    }
  }

  private settlePending(operationId: string, sessionId?: string): void {
    const matches = [...this.pending.entries()].filter(([, operation]) =>
      operation.operationId === operationId &&
      (sessionId === undefined || operation.sessionId === sessionId),
    );
    if (matches.length !== 1) return;
    const [[key, operation]] = matches;
    this.pending.delete(key);
    operation.resolve();
  }

  private progressKey(sessionId: string, operationId: string): string {
    return sessionId + "\u0000" + operationId;
  }

  private bump(): void {
    this.version += 1;
    this.notify();
  }

  getVersion(): number {
    return this.version;
  }

  publishProgress(entry: OperationProgress): boolean {
    const active = this.active.get(entry.sessionId);
    if (!active || active.id !== entry.operationId || this.latest.get(entry.sessionId) !== entry.operationId || this.closed.has(liveOperationKey(entry.sessionId, entry.operationId))) return false;
    const message = entry.message;
    if (
      message.id !== entry.messageId ||
      message.sessionId !== entry.sessionId ||
      message.turnId !== entry.turnId ||
      message.operationId !== entry.operationId ||
      message.attemptId !== entry.attemptId ||
      message.targetId !== entry.targetId
    ) return false;
    const key = this.progressKey(entry.sessionId, entry.operationId);
    const rows = this.progress.get(key) ?? new Map<string, OperationProgress>();
    const storedMessage = {
      ...cloneChatMessage(entry.message),
      text: entry.text,
      status: entry.status,
      error: entry.error,
    };
    rows.set(entry.messageId, cloneProgress({ ...entry, message: storedMessage }));
    this.progress.set(key, rows);
    this.bump();
    return true;
  }

  progressFor(sessionId: string): OperationProgress[] {
    const operationId = this.latest.get(sessionId);
    if (!operationId) return [];
    return [...(this.progress.get(this.progressKey(sessionId, operationId))?.values() ?? [])].map(cloneProgress);
  }

  private stopProgress(sessionId: string, operationId: string): boolean {
    const key = this.progressKey(sessionId, operationId);
    const rows = this.progress.get(key);
    if (!rows) return false;
    let changed = false;
    for (const [messageId, row] of rows) {
      if (row.status === "pending" || row.status === "streaming") {
        rows.set(messageId, cloneProgress({ ...row, status: "stopped", message: { ...row.message, status: "stopped" } }));
        changed = true;
      }
    }
    return changed;
  }

  private closeProgress(sessionId: string, operationId: string): boolean {
    return this.stopProgress(sessionId, operationId);
  }

  isOperationOpen(operationId: string, sessionId: string): boolean {
    return this.active.get(sessionId)?.id === operationId && !this.closed.has(liveOperationKey(sessionId, operationId));
  }

  markOperationStopped(sessionId: string, operationId: string): void {
    const active = this.active.get(sessionId);
    if (!active || active.id !== operationId) return;
    if (this.stopProgress(sessionId, operationId)) this.bump();
  }

  latestFor(sessionId: string): string | null {
    return this.latest.get(sessionId) ?? null;
  }

  isLatestOperation(operationId: string, sessionId: string): boolean {
    return this.latest.get(sessionId) === operationId;
  }

  /**
   * A closed key only matters while its operation id is still unique and its entry is
   * still in flight. Retaining every key for the life of the process would grow without
   * bound, so the oldest keys are evicted first: eviction is safe because isOperationOpen
   * also requires a live active entry, and start() re-arms its own key.
   */
  private noteClosed(sessionId: string, operationId: string): void {
    this.closed.add(liveOperationKey(sessionId, operationId));
    while (this.closed.size > SessionOperationCoordinator.CLOSED_TOMBSTONE_LIMIT) {
      const oldest = this.closed.values().next();
      if (oldest.done) break;
      this.closed.delete(oldest.value);
    }
  }

  /** Diagnostic only: the current retained closed-tombstone count. */
  closedTombstoneCount(): number {
    return this.closed.size;
  }

  cancel(sessionId: string): void {
    const handle = this.active.get(sessionId);
    if (!handle) return;
    // The binding plan defines cancellation as abort + immediate release. Durable finalizers
    // use message/attempt identity to avoid overwriting a newer operation after this release.
    this.closeProgress(sessionId, handle.id);
    this.noteClosed(sessionId, handle.id);
    handle.controller.abort(new Error("أُلغي العملية"));
    this.active.delete(sessionId);
    this.bump();
  }

  finish(operationId: string, sessionId?: string): void {
    const matches = [...this.active.entries()].filter(([candidateSession, handle]) =>
      handle.id === operationId && (sessionId === undefined || candidateSession === sessionId),
    );
    // Without a session, an ambiguous id is unsafe to close. Production callers
    // pass the captured session; the fallback keeps the old single-match API.
    if (matches.length === 1) {
      const [matchedSession] = matches[0]!;
      this.closeProgress(matchedSession, operationId);
      this.noteClosed(matchedSession, operationId);
      this.active.delete(matchedSession);
      this.bump();
    }
    // Cancellation already released active ownership, so finalization can call
    // finish with no active match. Resolve only the exact unique pending owner.
    this.settlePending(operationId, sessionId);
  }

  accepts(operationId: string, sessionId: string): boolean {
    return this.active.get(sessionId)?.id === operationId;
  }
}

function cloneTargetSnapshot(target: TargetSnapshot): TargetSnapshot {
  return {
    ...target,
    modelInfo: {
      ...target.modelInfo,
      pricing: target.modelInfo.pricing ? { ...target.modelInfo.pricing } : target.modelInfo.pricing,
    },
  };
}

export function buildRetryInput(attempt: TurnAttempt): { targets: TargetSnapshot[] } {
  return { targets: attempt.targets.map(cloneTargetSnapshot) };
}

export const sessionOperationCoordinator = new SessionOperationCoordinator();
