import Dexie from "dexie";
import type { ChatMessage, SessionMeta, UsageEvent } from "@/types";

export class ShuraDB extends Dexie {
  sessions!: Dexie.Table<SessionMeta, string>;
  messages!: Dexie.Table<ChatMessage, string>;
  usage_events!: Dexie.Table<UsageEvent, string>;
  settings!: Dexie.Table<{ key: string; value: unknown }, string>;

  constructor() {
    super("shura");
    this.version(1).stores({
      sessions: "id, updatedAt",
      messages: "id, sessionId, [sessionId+turnId], createdAt",
      usage_events: "id, sessionId, ts, providerId",
      settings: "key",
    });
  }
}

export const db = new ShuraDB();
