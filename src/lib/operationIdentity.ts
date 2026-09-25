/** Stable composite key for an operation scoped to one session. */
export function liveOperationKey(sessionId: string, operationId: string): string {
  return JSON.stringify([sessionId, operationId]);
}
