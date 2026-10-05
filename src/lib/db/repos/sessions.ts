/**
 * دورة حياة الجلسة: إنشاء، قراءة، تحديث، حذف مع شاهد الحذف (tombstone).
 * repos/sessions — extracted from the former single-file repos module.
 */

import { db } from "../db";
import type { SessionMeta } from "@/types";

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
