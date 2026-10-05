/**
 * سجلات التمرّرات (TurnRecord) والاستيراد الذري.
 * repos/turns — extracted from the former single-file repos module.
 */

import { db } from "../db";
import type { ChatMessage, SessionMeta, TurnRecord, UsageEvent } from "@/types";

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

/** نتيجة الاستيراد الذري: إما نجح، أو رفضه شاهد حذف. */
export type ImportSessionResult = "imported" | "tombstoned";

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
    // Guard against silent overwrite: if the session already exists in the DB, reject
    // rather than duplicating rows. The startup recovery path uses existingSessionCount()
    // to avoid this, but the public API must be safe on its own.
    const existing = await db.sessions.get(meta.id);
    if (existing) throw new Error("importSessionAtomically: session already exists");
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
