/**
 * مُسندات هوية الرسالة النقية (بلا وصول لقاعدة البيانات).
 * repos/identity — extracted from the former single-file repos module.
 */

import type { ChatMessage } from "@/types";

export function hasIdentity(message: ChatMessage): boolean {
  return Boolean(message.operationId || message.attemptId || message.attempt !== undefined);
}

export function hasCompleteIdentity(message: ChatMessage): message is ChatMessage & { operationId: string; attemptId: string; attempt: number } {
  return typeof message.operationId === "string" && message.operationId.length > 0 &&
    typeof message.attemptId === "string" && message.attemptId.length > 0 &&
    typeof message.attempt === "number" && Number.isInteger(message.attempt) && message.attempt > 0 &&
    typeof message.turnId === "string" && message.turnId.length > 0;
}

export function sameIdentity(left: ChatMessage, right: ChatMessage): boolean {
  return left.sessionId === right.sessionId && left.turnId === right.turnId &&
    left.operationId === right.operationId && left.attemptId === right.attemptId && left.attempt === right.attempt;
}

export function sameCoordinates(left: ChatMessage, right: ChatMessage): boolean {
  const stableKeys = ["turnId", "createdAt", "role", "kind", "promptKind", "targetId", "providerId", "modelId"] as const;
  if (stableKeys.some((key) => left[key] !== right[key])) return false;
  if (left.modelInfo !== undefined || right.modelInfo !== undefined) {
    if (!left.modelInfo || !right.modelInfo || JSON.stringify(left.modelInfo) !== JSON.stringify(right.modelInfo)) return false;
  }
  return true;
}

export function isTerminal(status: ChatMessage["status"]): boolean {
  return status === "done" || status === "error" || status === "stopped";
}


export function sameUsage(left: ChatMessage["usage"], right: ChatMessage["usage"]): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.inputTokens === right.inputTokens &&
    left.outputTokens === right.outputTokens &&
    left.cachedInputTokens === right.cachedInputTokens &&
    (left.cacheWriteInputTokens ?? 0) === (right.cacheWriteInputTokens ?? 0) &&
    left.costUSD === right.costUSD;
}

export function sameTerminalContent(left: ChatMessage, right: ChatMessage): boolean {
  return left.text === right.text && left.error === right.error && sameUsage(left.usage, right.usage);
}
