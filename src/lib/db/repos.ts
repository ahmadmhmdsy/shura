import { db } from "./db";
import type { ChatMessage, SessionMeta, TurnRecord, UsageEvent } from "@/types";

export async function createSession(meta: SessionMeta): Promise<void> { await db.sessions.put(meta); }

export async function listSessions(): Promise<SessionMeta[]> {
  return db.sessions.orderBy("updatedAt").reverse().toArray();
}

export async function getSession(id: string): Promise<SessionMeta | undefined> { return db.sessions.get(id); }

export async function updateSession(id: string, patch: Partial<SessionMeta>): Promise<void> {
  await db.sessions.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteSession(id: string): Promise<void> {
  await db.transaction("rw", [db.sessions, db.messages, db.usage_events], async () => {
    await db.sessions.delete(id);
    await db.messages.where("sessionId").equals(id).delete();
    await db.usage_events.where("sessionId").equals(id).delete();
  });
}

export type ImportSessionResult = "imported" | "tombstoned";

/** حذف كامل بيانات جلسة مع كتابة شاهد حذف (tombstone) في معاملة واحدة */
export async function deleteSessionData(id: string): Promise<void> {
  await db.transaction("rw", [db.sessions, db.messages, db.usage_events, db.turns, db.tombstones], async () => {
    await db.tombstones.put({ id, deletedAt: Date.now() });
    await db.sessions.delete(id);
    await db.messages.where("sessionId").equals(id).delete();
    await db.usage_events.where("sessionId").equals(id).delete();
    await db.turns.where("sessionId").equals(id).delete();
  });
}

export async function hasTombstone(id: string): Promise<boolean> {
  return (await db.tombstones.get(id)) !== undefined;
}

export async function putTurn(turn: TurnRecord): Promise<void> { await db.turns.put(turn); }

export async function getTurn(id: string): Promise<TurnRecord | undefined> {
  return db.turns.get(id);
}

export async function getTurns(sessionId: string): Promise<TurnRecord[]> {
  return db.turns.where("sessionId").equals(sessionId).sortBy("createdAt");
}

/** استيراد جلسة كاملة ذريًا: يفحص شاهد الحذف داخل نفس المعاملة قبل كتابة أي صف */
export async function importSessionAtomically(
  meta: SessionMeta,
  messages: ChatMessage[],
  turns: TurnRecord[],
  usageEvents: UsageEvent[],
): Promise<ImportSessionResult> {
  return db.transaction("rw", [db.sessions, db.messages, db.usage_events, db.turns, db.tombstones], async () => {
    if (await db.tombstones.get(meta.id)) return "tombstoned";
    await db.sessions.put(meta);
    for (const m of messages) {
      if (m.sessionId !== meta.id) throw new Error("importSessionAtomically: foreign message " + m.id);
      await db.messages.put(m);
    }
    for (const t of turns) {
      if (t.sessionId !== meta.id) throw new Error("importSessionAtomically: foreign turn " + t.id);
      await db.turns.put(t);
    }
    for (const e of usageEvents) {
      if (e.sessionId !== meta.id) throw new Error("importSessionAtomically: foreign usage event " + e.id);
      await db.usage_events.put(e);
    }
    return "imported";
  });
}

export async function appendMessage(msg: ChatMessage): Promise<void> { await db.messages.put(msg); }

export async function getMessages(sessionId: string): Promise<ChatMessage[]> {
  return db.messages.where("sessionId").equals(sessionId).sortBy("createdAt");
}

export async function recordUsage(ev: UsageEvent): Promise<void> { await db.usage_events.put(ev); }

export async function getUsageEvents(filter?: { sessionId?: string; providerId?: string; fromTs?: number }): Promise<UsageEvent[]> {
  const narrow = (list: UsageEvent[]): UsageEvent[] =>
    list.filter((e) => (filter?.providerId ? e.providerId === filter.providerId : true));
  if (filter?.sessionId) {
    const list = await db.usage_events.where("sessionId").equals(filter.sessionId).sortBy("ts");
    return narrow(list).filter((e) => (filter.fromTs ? e.ts >= filter.fromTs : true));
  }
  if (filter?.fromTs) {
    const list = await db.usage_events.where("ts").aboveOrEqual(filter.fromTs).toArray();
    return narrow(list);
  }
  return narrow(await db.usage_events.orderBy("ts").toArray());
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const row = await db.settings.get(key);
  return row?.value as T | undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> { await db.settings.put({ key, value }); }
