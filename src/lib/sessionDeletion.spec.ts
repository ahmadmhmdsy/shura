import { describe, expect, it, vi } from "vitest";
import { memoryFileSink } from "./markdown/sink";
import { appendTurn } from "./markdown/writer";
import { recoverFromDisk } from "./markdown/parser";
import { deleteSessionDurably, writeDiskTombstone } from "./sessionDeletion";

const meta = {
  id: "del-1", title: "لحذف", createdAt: 1, updatedAt: 2, modelIds: ["m"],
  primaryTarget: null, layoutMode: "vertical" as const, onDisk: true, onDiskDir: "folder-del",
};

const turnData = {
  turn: { id: "turn-1", sharedPrompt: "سؤال", customs: {} },
  prompts: [{ targetId: "t1", providerId: "openrouter" as const, modelId: "gpt-4o", text: "سؤال", hasShared: true, hasCustom: false }],
  results: [{ targetId: "t1", text: "جواب", usage: null }],
  status: { t1: "done" }, errors: {}, createdAt: 10, attemptId: "at-1",
};

describe("writeDiskTombstone", () => {
  it("يكتب الشاهد عبر ملف مؤقت ثم يغيّر الاسم", async () => {
    const sink = memoryFileSink();
    const calls: string[] = [];
    const base = memoryFileSink();
    const spySink = {
      ...base,
      async writeFile(p: string, c: string) { calls.push("write:" + p); await base.writeFile(p, c); },
      async rename(a: string, b: string) { calls.push("rename:" + a); await base.rename(a, b); },
    };
    await writeDiskTombstone(spySink, "del-1", "sessions", () => 1234);
    const witness = JSON.parse(await base.readFile("sessions/tombstones/del-1.json"));
    expect(witness).toEqual({ id: "del-1", deletedAt: 1234 });
    expect(calls).toContain("rename:sessions/tombstones/del-1.json.tmp");
    expect(await base.exists("sessions/tombstones/del-1.json.tmp")).toBe(false);
    expect(sink).toBeDefined();
  });

  it("يرفض معرّفًا غير آمن قبل الكتابة", async () => {
    const base = memoryFileSink();
    await expect(writeDiskTombstone(base, "../escape", "sessions")).rejects.toThrow();
    expect(await base.exists("sessions/tombstones")).toBe(false);
  });
});

describe("deleteSessionDurably", () => {
  it("يكتب شاهد الحذف قبل معاملة قاعدة البيانات ثم يحذف الأرشيف", async () => {
    const sink = memoryFileSink();
    await appendTurn(sink, "sessions/folder-del", meta, turnData);
    const order: string[] = [];
    const base = memoryFileSink();
    for (const p of sink.tree()) await base.writeFile(p, await sink.readFile(p));
    const watched = {
      ...base,
      async rename(a: string, b: string) { order.push("tombstone"); await base.rename(a, b); },
    };
    const result = await deleteSessionDurably(meta, watched, "sessions", {
      deleteData: async () => { order.push("db"); },
    });
    expect(order).toEqual(["tombstone", "db"]);
    expect(result).toEqual({ deleted: true });
    expect(await base.exists("sessions/folder-del/meta.json")).toBe(false);
    expect(await base.exists("sessions/tombstones/del-1.json")).toBe(true);
  });

  it("فشل قاعدة البيانات يبقي الجلسة والأرشيف ويبث خطأ محدودًا قابلًا لإعادة المحاولة", async () => {
    const sink = memoryFileSink();
    await appendTurn(sink, "sessions/folder-del", meta, turnData);
    await expect(deleteSessionDurably(meta, sink, "sessions", {
      deleteData: async () => { throw new Error("QuotaExceededError at C:\\Users\\name\\Shura\\shura.db with sk-secret-123456789"); },
    })).rejects.toThrow();
    const error = await deleteSessionDurably(meta, sink, "sessions", {
      deleteData: async () => { throw new Error("QuotaExceededError at C:\\Users\\name\\Shura\\shura.db with sk-secret-123456789"); },
    }).catch((e: Error) => e);
    expect(String(error)).not.toContain("sk-secret");
    expect(String(error)).not.toContain("C:\\Users");
    expect((error as { retryable?: boolean }).retryable).toBe(true);
    expect(await sink.exists("sessions/folder-del/meta.json")).toBe(true);
    expect(await sink.exists("sessions/tombstones/del-1.json")).toBe(true);
  });

  it("فشل حذف الأرشيف يبقي الشاهد ويعيد نتيجة قابلة لإعادة المحاولة", async () => {
    const sink = memoryFileSink();
    await appendTurn(sink, "sessions/folder-del", meta, turnData);
    const base = memoryFileSink();
    for (const p of sink.tree()) await base.writeFile(p, await sink.readFile(p));
    let fail = true;
    const flaky = {
      ...base,
      async remove(p: string, options?: { recursive?: boolean }) {
        if (fail && p.includes("folder-del")) throw new Error("EBUSY: E:\\data\\Shura\\sessions\\folder-del");
        return base.remove(p, options);
      },
    };
    const deleteData = vi.fn(async () => undefined);
    const first = await deleteSessionDurably(meta, flaky, "sessions", { deleteData });
    expect(first.deleted).toBe(true);
    expect(first.retryable).toBe(true);
    expect(first.warning).toBeTruthy();
    expect(first.warning).not.toContain("E:\\data");
    expect(deleteData).toHaveBeenCalledTimes(1);
    expect(await base.exists("sessions/folder-del/meta.json")).toBe(true);
    expect(await base.exists("sessions/tombstones/del-1.json")).toBe(true);
    fail = false;
    const second = await deleteSessionDurably(meta, flaky, "sessions", { deleteData });
    expect(second).toEqual({ deleted: true });
    expect(await base.exists("sessions/folder-del/meta.json")).toBe(false);
    expect(await base.exists("sessions/tombstones/del-1.json")).toBe(true);
  });

  it("يرفض مسارات خطرة قبل أي كتابة أو حذف", async () => {
    for (const dir of ["../escape", "a/b", "..", "", "tombstones", "C:\\x", "with\\0null"]) {
      const sink = memoryFileSink();
      const deleteData = vi.fn(async () => undefined);
      await expect(deleteSessionDurably({ ...meta, onDiskDir: dir }, sink, "sessions", { deleteData })).rejects.toThrow();
      expect(deleteData).not.toHaveBeenCalled();
      expect(await sink.exists("sessions/tombstones/del-1.json")).toBe(false);
    }
  });

  it("يحذف قاعدة البيانات فقط في وضع الويب بلا أرشيف", async () => {
    const deleteData = vi.fn(async () => undefined);
    const result = await deleteSessionDurably({ ...meta, onDisk: false, onDiskDir: undefined }, null, "sessions", { deleteData });
    expect(result).toEqual({ deleted: true });
    expect(deleteData).toHaveBeenCalledWith("del-1");
  });

  it("لا ينشر أرشيفًا بعد الحذف ولا يستعيد الأرشيف عند إعادة الفحص", async () => {
    const sink = memoryFileSink();
    await appendTurn(sink, "sessions/folder-del", meta, turnData);
    await deleteSessionDurably(meta, sink, "sessions", { deleteData: async () => undefined });
    await expect(appendTurn(sink, "sessions/folder-del", meta, { ...turnData, attemptId: "at-2" })).rejects.toThrow();
    expect(await sink.exists("sessions/folder-del/meta.json")).toBe(false);
    // A rescan after deletion must import nothing: the bytes are gone and the witness stays.
    const report = await recoverFromDisk(sink, "sessions");
    expect(report.imported).toHaveLength(0);
    expect(await sink.exists("sessions/tombstones/del-1.json")).toBe(true);
    // A residual archive (failed cleanup) still cannot be resurrected by a database reset.
    await sink.writeFile("sessions/folder-del/meta.json", JSON.stringify({
      schemaVersion: 2, meta, updatedAt: 2, turns: [],
    }));
    const afterReset = await recoverFromDisk(sink, "sessions");
    expect(afterReset.imported).toHaveLength(0);
    expect(afterReset.skippedTombstoned).toEqual(["del-1"]);
  });
});
