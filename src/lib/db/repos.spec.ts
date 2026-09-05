import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { appendMessage, createSession, deleteSession, getMessages, getSetting, listSessions, recordUsage, setSetting, updateSession } from "./repos";
import type { ChatMessage, SessionMeta, UsageEvent } from "@/types";

const session = (id: string): SessionMeta => ({ id, title: "جلسة " + id, createdAt: 1, updatedAt: 1, modelIds: [], primaryTarget: null, layoutMode: "vertical", onDisk: false });

beforeEach(async () => { await db.sessions.clear(); await db.messages.clear(); await db.usage_events.clear(); await db.settings.clear(); });

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
    const base = { sessionId: "a", turnId: "t1", createdAt: 0, role: "user" as const, kind: "prompt" as const, text: "", status: "done" as const };
    const m1: ChatMessage = { ...base, id: "m1", text: "س1", createdAt: 10 };
    const m2: ChatMessage = { ...base, id: "m2", text: "س2", createdAt: 20 };
    await appendMessage(m1); await appendMessage(m2);
    const got = await getMessages("a");
    expect(got.map((m) => m.text)).toEqual(["س1", "س2"]);
  });
  it("حذف جلسة يمسح رسائلها واستهلاكها", async () => {
    await createSession(session("a"));
    const ev: UsageEvent = { id: "u1", sessionId: "a", turnId: "t1", ts: 1, providerId: "openrouter", modelId: "m", inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, costUSD: 0, toolCalls: 0, durationMs: 1, status: "ok" };
    await recordUsage(ev);
    await appendMessage({ id: "m1", sessionId: "a", turnId: "t1", createdAt: 1, role: "user", kind: "prompt", text: "x", status: "done" });
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
