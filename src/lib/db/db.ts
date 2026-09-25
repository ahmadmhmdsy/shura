import Dexie from "dexie";
import type { ChatMessage, OperationLease, SessionMeta, SessionTombstone, TurnRecord, UsageEvent } from "@/types";

export class ShuraDB extends Dexie {
  sessions!: Dexie.Table<SessionMeta, string>;
  messages!: Dexie.Table<ChatMessage, string>;
  usage_events!: Dexie.Table<UsageEvent, string>;
  settings!: Dexie.Table<{ key: string; value: unknown }, string>;
  turns!: Dexie.Table<TurnRecord, string>;
  tombstones!: Dexie.Table<SessionTombstone, string>;
  operation_leases!: Dexie.Table<OperationLease, string>;
  // [المهمة 9] مفاتيح المزودين مشفّرة على الويب؛ لا تُخزَّن إلا الشيفرة و‎IV.
  credentials!: Dexie.Table<{ providerId: string; iv: string; ciphertext: ArrayBuffer }, string>;

  // The optional name is only for isolated migration tests; production uses "shura".
  constructor(name = "shura") {
    super(name);
    this.version(1).stores({
      sessions: "id, updatedAt",
      messages: "id, sessionId, [sessionId+turnId], createdAt",
      usage_events: "id, sessionId, ts, providerId",
      settings: "key",
    });
    // One declaration per version: a repeated version(2).stores() is ambiguous about
    // which definition owns the upgrade and invites future schema drift.
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
    this.version(3).stores({
      sessions: "id, updatedAt",
      messages: "id, sessionId, [sessionId+turnId], createdAt",
      usage_events: "id, sessionId, ts, providerId",
      settings: "key",
      turns: "id, sessionId, createdAt, status",
      tombstones: "id, deletedAt",
      operation_leases: "sessionId, operationId, status, updatedAt",
      credentials: "providerId",
    });
  }
}

export const db = new ShuraDB();