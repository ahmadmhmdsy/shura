import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { ShuraDB } from "./db";
import { createSession, deleteSessionData, hasTombstone, importSessionAtomically } from "./repos";
import { meta, oldSession, usageEvent } from "@/test/helpers";

const DB_NAME = "shura-migration-test";

describe("ShuraDB v2 migration", () => {
  afterEach(async () => {
    await Dexie.delete(DB_NAME);
  });

  it("adds turns and tombstones without removing existing sessions", async () => {
    const legacy = new Dexie(DB_NAME);
    legacy.version(1).stores({
      sessions: "id, updatedAt",
      messages: "id, sessionId, [sessionId+turnId], createdAt",
      usage_events: "id, sessionId, ts, providerId",
      settings: "key",
    });
    await legacy.open();
    await legacy.table("sessions").put(oldSession("s1"));
    await legacy.table("usage_events").put(usageEvent("u1", "s1"));
    await legacy.close();

    const upgraded = new ShuraDB(DB_NAME);
    await upgraded.open();
    const s1 = await upgraded.sessions.get("s1");
    expect(s1).toBeTruthy();
    expect(s1?.contextMode).toBe("stateful");
    expect(s1?.targets).toEqual([]);
    expect((await upgraded.usage_events.toArray())[0]?.cacheWriteInputTokens).toBe(0);
    expect(upgraded.turns).toBeDefined();
    expect(upgraded.tombstones).toBeDefined();
    await upgraded.close();
  });

  it("keeps a tombstone after deleting a session", async () => {
    await createSession(meta("s2"));
    await deleteSessionData("s2");
    expect(await hasTombstone("s2")).toBe(true);
    expect(await importSessionAtomically(meta("s2"), [], [], [])).toBe("tombstoned");
    expect(await hasTombstone("s2")).toBe(true);
  });
});
