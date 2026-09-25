/**
 * One shared per-directory archive queue. The writer and the durable-deletion service
 * both publish through it, so an in-flight append can never land after a deletion.
 */

const chains = new Map<string, Promise<unknown>>();

/** Trailing slashes and backslashes are not distinct archive directories. */
export function archiveQueueKey(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

export function archiveQueueDepth(): number {
  return chains.size;
}

export function runExclusiveInArchive<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const key = archiveQueueKey(path);
  const previous = chains.get(key) ?? Promise.resolve();
  // The chain link swallows the predecessor result: one failure must not poison the
  // next operation, and only the caller of the failing operation sees its rejection.
  const run = previous.then(operation, operation);
  const link = run.then(
    () => undefined,
    () => undefined,
  );
  chains.set(key, link);
  void link.then(() => {
    // Remove only our own completed link, so a newer queued operation is never dropped.
    if (chains.get(key) === link) chains.delete(key);
  });
  return run;
}
