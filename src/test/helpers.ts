import type { TurnRecord, ChatMessage, SessionMeta, UsageEvent } from "@/types";

/**
 * A legacy row exactly as it was persisted in schema v1: it lacks the
 * v2 experience fields (contextMode/targets/cacheWriteInputTokens/attemptId).
 * The cast documents that the migration must tolerate this shape.
 */
export function oldSession(id: string): SessionMeta {
  return {
    id,
    title: "جلسة " + id,
    createdAt: 1,
    updatedAt: 1,
    modelIds: ["m1"],
    primaryTarget: null,
    layoutMode: "vertical",
    onDisk: false,
  } as SessionMeta;
}

/** A schema-v2 session: stateful by default with an empty target list. */
export function meta(id: string): SessionMeta {
  return {
    ...oldSession(id),
    contextMode: "stateful",
    targets: [],
  };
}

export function turnRecord(id: string, sessionId: string, over: Partial<TurnRecord> = {}): TurnRecord {
  return {
    id,
    sessionId,
    createdAt: 1,
    status: "done",
    contextMode: "stateful",
    sharedPrompt: null,
    attempts: [],
    ...over,
  };
}

export function chatMessage(id: string, sessionId: string, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    sessionId,
    turnId: "t1",
    createdAt: 1,
    role: "user",
    kind: "prompt",
    text: "",
    status: "done",
    attemptId: "at1",
    operationId: "op1",
    attempt: 1,
    superseded: false,
    ...over,
  };
}

export function usageEvent(id: string, sessionId: string, over: Partial<UsageEvent> = {}): UsageEvent {
  return {
    id,
    sessionId,
    turnId: "t1",
    ts: 1,
    providerId: "openrouter",
    modelId: "m1",
    inputTokens: 1,
    outputTokens: 1,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    costUSD: null,
    toolCalls: 0,
    durationMs: 1,
    status: "ok",
    attemptId: "at1",
    ...over,
  };
}
