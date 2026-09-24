import Dexie from "dexie";
import type { ChatMessage, SessionMeta, SessionTombstone, TurnRecord, UsageEvent } from "@/types";

export class ShuraDB extends Dexie {
  sessions!: Dexie.Table<SessionMeta, string>;
  messages!: Dexie.Table<ChatMessage, string>;
  usage_events!: Dexie.Table<UsageEvent, string>;
  settings!: Dexie.Table<{ key: string; value: unknown }, string>;
  turns!: Dexie.Table<TurnRecord, string>;
  tombstones!: Dexie.Table<SessionTombstone, string>;

  // The optional name is only for isolated migration tests; production uses "shura".
  constructor(name = "shura") {
    super(name);
    this.version(1).stores({
      sessions: "id, updatedAt",
      messages: "id, sessionId, [sessionId+turnId], createdAt",
      usage_events: "id, sessionId, ts, providerId",
      settings: "key",
    });
    this.version(2).stores({
      sessions: "id, updatedAt",
      messages: "id, sessionId, [sessionId+turnId], createdAt",
      usage_events: "id, sessionId, ts, providerId",
      settings: "key",
      turns: "id, sessionId, createdAt, status",
      tombstones: "id, deletedAt",
    }).upgrade(async (tx) => {
      const sessions = tx.table<SessionMeta, string>("sessions");
      const usage = tx.table<UsageEvent, string>("usage_events");
      for (const session of await sessions.toArray()) {
        session.contextMode ??= "stateful";
        session.targets ??= [];
        await sessions.put(session);
      }
      for (const event of await usage.toArray()) {
        event.cacheWriteInputTokens ??= 0;
        await usage.put(event);
      }
    });
  }
}

export const db = new ShuraDB();
