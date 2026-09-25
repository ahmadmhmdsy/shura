import { runExclusiveInArchive } from "./markdown/archiveQueue";
import { assertSafeSessionDir, isSafePathSegment, tombstonesDirOf } from "./markdown/archivePaths";
import type { FileSink } from "./markdown/sink";
import { deleteSessionData } from "./db/repos";
import { redactExternalError } from "./security/redact";
import type { SessionMeta } from "@/types";

export interface DeleteSessionResult {
  deleted: boolean;
  warning?: string;
  retryable?: boolean;
}

export class SessionDeletionError extends Error {
  readonly retryable = true;
  constructor(message: string) {
    super(message);
    this.name = "SessionDeletionError";
  }
}

export interface DeleteSessionOptions {
  /** Injected in tests; production uses the single Dexie deletion transaction. */
  deleteData?: (id: string) => Promise<void>;
  now?: () => number;
}

export const DEFAULT_ARCHIVE_ROOT = "sessions";

/** The witness is the commit marker of a deletion: temp file then rename. */
export async function writeDiskTombstone(sink: FileSink, id: string, rootDir = DEFAULT_ARCHIVE_ROOT, now: () => number = Date.now): Promise<void> {
  if (!isSafePathSegment(id)) throw new SessionDeletionError("معرّف الجلسة غير صالح لكتابة شاهد الحذف");
  const dir = tombstonesDirOf(rootDir);
  const path = dir + "/" + id + ".json";
  const temp = path + ".tmp";
  await sink.ensureDir(dir);
  await sink.writeFile(temp, JSON.stringify({ id, deletedAt: now() }));
  await sink.rename(temp, path);
}

function archivePathFor(rootDir: string, onDiskDir: string): string {
  return rootDir ? rootDir + "/" + onDiskDir : onDiskDir;
}

/**
 * Fixed order: validate, serialize with archive writers, publish the disk witness,
 * delete the database rows, then remove the archive bytes. Nothing is removed from disk
 * before the database transaction succeeds, and the witness survives a retry.
 */
export async function deleteSessionDurably(
  session: SessionMeta,
  sink: FileSink | null,
  rootDir = DEFAULT_ARCHIVE_ROOT,
  options: DeleteSessionOptions = {},
): Promise<DeleteSessionResult> {
  if (typeof session?.id !== "string" || !session.id) throw new SessionDeletionError("معرّف الجلسة غير صالح للحذف");
  // A present but empty/unsafe onDiskDir is corruption and must be rejected; only an
  // absent value means "this session has no archive".
  const onDiskDir = session.onDiskDir === undefined ? null : assertSafeSessionDir(session.onDiskDir);
  const deleteData = options.deleteData ?? deleteSessionData;
  const now = options.now ?? Date.now;
  if (!sink) {
    await deleteData(session.id);
    return { deleted: true };
  }
  const archivePath = onDiskDir ? archivePathFor(rootDir, onDiskDir) : rootDir;
  return runExclusiveInArchive(onDiskDir ? archivePath : rootDir, async () => {
    await writeDiskTombstone(sink, session.id, rootDir, now);
    try {
      await deleteData(session.id);
    } catch (error) {
      // The session stays visible and the witness stays: the caller can retry safely.
      throw new SessionDeletionError("تعذر حذف بيانات الجلسة: " + redactExternalError(error));
    }
    if (!onDiskDir) return { deleted: true };
    try {
      await sink.remove(archivePath, { recursive: true });
      return { deleted: true };
    } catch (error) {
      // The database deletion already succeeded, so the session stays gone and the
      // archive bytes are reported as a retryable warning instead of being hidden.
      return {
        deleted: true,
        warning: "تعذر حذف ملفات الأرشيف: " + redactExternalError(error),
        retryable: true,
      };
    }
  });
}
