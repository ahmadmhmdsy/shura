import type { FileSink } from "./sink";

/**
 * Canonical archive path policy shared by the writer, recovery, and durable deletion.
 * The Tauri sink already scopes paths lexically; these rules are the logical policy that
 * protects every sink, including the in-memory one used by tests.
 */

export const RESERVED_ARCHIVE_DIRS: readonly string[] = ["tombstones", "quarantine"];

const MAX_SEGMENT_LENGTH = 128;

export class ArchivePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchivePathError";
  }
}

/** Exactly one safe path segment: no separators, no traversal, no control characters. */
export function isSafePathSegment(segment: unknown): segment is string {
  if (typeof segment !== "string") return false;
  if (!segment || segment.length > MAX_SEGMENT_LENGTH) return false;
  if (segment === "." || segment === "..") return false;
  if (RESERVED_ARCHIVE_DIRS.includes(segment)) return false;
  if (segment.includes("/") || segment.includes("\\")) return false;
  // A colon would allow a Windows drive prefix such as "C:". Control characters are
  // filtered by code point because an explicit control range in a regex literal is
  // rejected by eslint no-control-regex.
  if (/[<>":]/.test(segment)) return false;
  for (const character of segment) {
    const code = character.codePointAt(0)!;
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return true;
}

export function assertSafeSessionDir(onDiskDir: unknown): string {
  if (!isSafePathSegment(onDiskDir)) {
    throw new ArchivePathError("مجلد الجلسة على القرص غير صالح للحذف");
  }
  return onDiskDir;
}

export function archiveRootOf(dir: string): string {
  const normalized = dir.replace(/[\\/]+$/, "");
  const cut = normalized.lastIndexOf("/");
  return cut > 0 ? normalized.slice(0, cut) : "";
}

export function tombstonesDirOf(root: string): string {
  return root ? root + "/tombstones" : "tombstones";
}

export function quarantineDirOf(root: string): string {
  return root ? root + "/quarantine" : "quarantine";
}

export interface DiskTombstone { id: string; deletedAt: number; }

export class TombstoneSetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TombstoneSetError";
  }
}

/**
 * Reads the deletion witnesses. An unreadable or malformed witness set fails closed:
 * treating it as empty would let a permanently deleted session be imported again.
 */
export async function readDiskTombstones(sink: FileSink, root: string): Promise<Set<string>> {
  const dir = tombstonesDirOf(root);
  let names: string[];
  try {
    names = await sink.readDir(dir);
  } catch {
    // No tombstone directory means no deletion has been recorded yet.
    return new Set();
  }
  const ids = new Set<string>();
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await sink.readFile(dir + "/" + name));
    } catch {
      throw new TombstoneSetError("شاهد حذف تالف: تعذّر قراءة مجموعة الشواهد");
    }
    const record = parsed as Partial<DiskTombstone> | null;
    const base = name.slice(0, -5);
    if (!record || record.id !== base || !isSafePathSegment(base) || !Number.isFinite(record.deletedAt)) {
      throw new TombstoneSetError("شاهد حذف تالف: محتوى غير متسق مع اسمه");
    }
    ids.add(record.id);
  }
  return ids;
}
