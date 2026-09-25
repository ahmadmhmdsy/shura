import type { SessionMeta, TargetSnapshot, UsageEvent } from "@/types";
import type { ArchiveTurn } from "./writer";

export function archiveMessageId(turn: Pick<ArchiveTurn, "turnId" | "attemptId">, suffix: string): string {
  return turn.turnId + ":" + turn.attemptId + ":" + suffix;
}

/** Returns null when the archive has no provider snapshot, so nothing is invented. */
export function buildRecoveredUsageEvent(
  turn: ArchiveTurn,
  meta: SessionMeta,
  result: ArchiveTurn["results"][number],
  prompt: TargetSnapshot | undefined,
): UsageEvent | null {
  if (!result.usage || !prompt) return null;
  return {
    id: archiveMessageId(turn, result.targetId),
    sessionId: meta.id,
    turnId: turn.turnId,
    ts: turn.createdAt,
    providerId: prompt.providerId,
    modelId: prompt.modelId,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    cachedInputTokens: result.usage.cachedInputTokens,
    cacheWriteInputTokens: result.usage.cacheWriteInputTokens ?? 0,
    costUSD: result.usage.costUSD,
    toolCalls: 0,
    durationMs: 0,
    status: result.status === "error" ? "error" : "ok",
    attemptId: turn.attemptId,
    operationId: turn.operationId,
  };
}
