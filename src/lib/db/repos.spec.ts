import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import {
  appendMessage,
  createSession,
  deleteSession,
  deleteSessionData,
  getMessages,
  getSetting,
  getTurn,
  getTurns,
  hasTombstone,
  importSessionAtomically,
  listSessions,
  putTurn,
  recordUsage,
  setSetting,
  updateSession,
} from "./repos";
import type { ChatMessage, SessionMeta, UsageEvent } from "@/types";
import { chatMessage, meta, turnRecord, usageEvent as mkUsage } from "@/test/helpers";

const session = (id: string): SessionMeta => ({ id, title: "جلسة " + id, createdAt: 1, updatedAt: 1, modelIds: [], primaryTarget: null, layoutMode: "vertical", onDisk: false, contextMode: "stateful", targets: [] });

beforeEach(async () => {
  await db.sessions.clear();
  await db.messages.clear();
  await db.usage_events.clear();
  await db.turns.clear();
  await db.tombstones.clear();
  await db.settings.clear();
});

describe("repos", () => {
  it("إنشاء جلسة وسرد الجلسات بترتيب التحديث", async () => {
    await createSession(session("a"));
    await createSession({ ...session("b"), updatedAt: 5 });
    const list = await listSessions();
    expect(list.map((s) => s.id)).toEqual(["b", "a"]);
  });
  it("تطبيق تحديث على جلسة", async () => {
    await createSession(session("a"));
    await updateSession("a", { title: "معدلة", onDisk: true });
    const s = (await listSessions())[0];
    expect(s.title).toBe("معدلة");
    expect(s.onDisk).toBe(true);
  });
  it("إلحاق رسائل وجلبها بترتيب الإنشاء", async () => {
    await createSession(session("a"));
    const m1 = chatMessage("m1", "a", { createdAt: 10, text: "س1" });
    const m2 = chatMessage("m2", "a", { createdAt: 20, text: "س2" });
    await appendMessage(m1); await appendMessage(m2);
    const got = await getMessages("a");
    expect(got.map((m) => m.text)).toEqual(["س1", "س2"]);
  });
  it("حذف جلسة يمسح رسائلها واستهلاكها", async () => {
    await createSession(session("a"));
    await recordUsage(mkUsage("u1", "a"));
    await appendMessage(chatMessage("m1", "a"));
    await deleteSession("a");
    expect(await getMessages("a")).toEqual([]);
    expect(await db.usage_events.where("sessionId").equals("a").count()).toBe(0);
  });
  it("الإعدادات: تدوير قيمة", async () => {
    await setSetting("theme", "dark");
    expect(await getSetting<string>("theme")).toBe("dark");
    await setSetting("theme", "light");
    expect(await getSetting<string>("theme")).toBe("light");
  });
});

describe("turns and tombstones (schema v2)", () => {
  it("deleteSessionData removes every row and writes a tombstone atomically", async () => {
    await createSession(meta("t1"));
    await appendMessage(chatMessage("m1", "t1"));
    await recordUsage(mkUsage("u1", "t1"));
    await putTurn(turnRecord("tr1", "t1"));
    await deleteSessionData("t1");
    expect(await db.sessions.get("t1")).toBeUndefined();
    expect(await db.messages.where("sessionId").equals("t1").count()).toBe(0);
    expect(await db.usage_events.where("sessionId").equals("t1").count()).toBe(0);
    expect(await db.turns.where("sessionId").equals("t1").count()).toBe(0);
    expect(await hasTombstone("t1")).toBe(true);
    // Idempotent: deleting again keeps exactly one tombstone.
    await deleteSessionData("t1");
    expect(await db.tombstones.count()).toBe(1);
  });

  it("importSessionAtomically writes the whole payload or rejects on tombstone", async () => {
    const m: ChatMessage[] = [chatMessage("m1", "t2")];
    const u: UsageEvent[] = [mkUsage("u1", "t2")];
    expect(await importSessionAtomically(meta("t2"), m, [turnRecord("tr1", "t2")], u)).toBe("imported");
    expect(await db.sessions.get("t2")).toBeTruthy();
    expect(await getTurn("tr1")).toBeTruthy();
    expect((await getTurns("t2")).map((t) => t.id)).toEqual(["tr1"]);
    expect(await getMessages("t2")).toHaveLength(1);
    // Tombstoned sessions cannot be imported again; nothing is written.
    await deleteSessionData("t3");
    const before = await db.sessions.count();
    expect(await importSessionAtomically(meta("t3"), m, [], u)).toBe("tombstoned");
    expect(await db.sessions.count()).toBe(before);
  });

  it("putTurn/getTurn/getTurns round-trip turns by session", async () => {
    await putTurn(turnRecord("tr1", "t4", { createdAt: 2 }));
    await putTurn(turnRecord("tr2", "t4", { createdAt: 1 }));
    await putTurn(turnRecord("tr3", "t5"));
    expect((await getTurns("t4")).map((t) => t.id)).toEqual(["tr2", "tr1"]);
    expect((await getTurn("tr1"))?.sessionId).toBe("t4");
    expect(await getTurn("missing")).toBeUndefined();
  });
});
