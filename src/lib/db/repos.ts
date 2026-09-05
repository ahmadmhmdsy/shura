import { db } from "./db";
import type { ChatMessage, SessionMeta, UsageEvent } from "@/types";

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
