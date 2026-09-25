import { describe, expect, it } from "vitest";
import { memoryFileSink } from "./markdown/sink";
import type { FileSink } from "./markdown/sink";
import { appendTurn, writeSessionMeta } from "./markdown/writer";
import { recoverFromDisk } from "./markdown/parser";

const meta = { id: "rec-1", title: "جلسة استرجاع", createdAt: 1, updatedAt: 2, modelIds: ["m"], primaryTarget: null, layoutMode: "vertical" as const, onDisk: true, onDiskDir: "folder-one" };

const turnData = {
  turn: { id: "turn-1", sharedPrompt: "سؤال", customs: {} },
  prompts: [{ targetId: "t1", providerId: "openrouter" as const, modelId: "gpt-4o", text: "سؤال", hasShared: true, hasCustom: false }],
  results: [{ targetId: "t1", text: "جواب", usage: { inputTokens: 4, outputTokens: 6, cachedInputTokens: 0, costUSD: 0.5 } }],
  status: { t1: "done" },
  errors: {},
  createdAt: 10,
  attemptId: "at-1",
};

function brokenManifest(value: unknown) {
  return { schemaVersion: 2, meta, updatedAt: 1, turns: value };
}

describe("RecoveryReport", () => {
  it("يستورد الجلسات الصالحة ويتجاهل المجلدات المحجوزة", async () => {
    const sink = memoryFileSink();
    await appendTurn(sink, "sessions/folder-one", meta, turnData);
    await sink.writeFile("sessions/quarantine/old/meta.json", "{}");
    await sink.writeFile("sessions/tombstones/rec-2.json", JSON.stringify({ id: "rec-2", deletedAt: 1 }));
    const report = await recoverFromDisk(sink, "sessions", { now: () => 1700 });
    expect(report.imported.map((s) => s.meta.id)).toEqual(["rec-1"]);
    expect(report.quarantined).toEqual([]);
    expect(report.errors).toEqual([]);
  });

  it("لا يستورد إلا التمريرات المذكورة في آخر مخطط صالح", async () => {
    const sink = memoryFileSink();
    await appendTurn(sink, "sessions/folder-one", meta, turnData);
    // An orphaned attempt directory that the commit marker never listed.
    await sink.writeFile("sessions/folder-one/turns/t99/01_openrouter__gpt-4o.md", "نص يتيم");
    const report = await recoverFromDisk(sink, "sessions");
    expect(report.imported[0].messages.map((m) => m.text)).not.toContain("نص يتيم");
    expect(report.imported[0].turns[0].attempts).toHaveLength(1);
  });

  it("يعيد بناء جدول التمريرات بمحاولات ولقطات وحالات واستهلاك", async () => {
    const sink = memoryFileSink();
    await appendTurn(sink, "sessions/folder-one", meta, { ...turnData, attemptId: "at-1" });
    await appendTurn(sink, "sessions/folder-one", meta, { ...turnData, attemptId: "at-2", attemptNumber: 2, kind: "retry", operationId: "op-2", createdAt: 20 });
    const report = await recoverFromDisk(sink, "sessions");
    const record = report.imported[0].turns[0];
    expect(record.id).toBe("turn-1");
    expect(record.sessionId).toBe("rec-1");
    expect(record.sharedPrompt).toBe("سؤال");
    expect(record.attempts).toHaveLength(2);
    expect(record.attempts[0].id).toBe("at-1");
    expect(record.attempts[0].superseded).toBe(true);
    expect(record.attempts[1].attempt).toBe(2);
    expect(record.attempts[1].kind).toBe("retry");
    expect(record.attempts[1].operationId).toBe("op-2");
    expect(record.attempts[1].targets[0].promptText).toBe("سؤال");
    expect(record.attempts[1].targets[0].modelInfo.id).toBe("gpt-4o");
    expect(record.attempts[1].status).toBe("done");
    expect(report.imported[0].usageEvents.every((u) => u.attemptId)).toBe(true);
    expect(report.imported[0].messages.every((m) => m.attemptId)).toBe(true);
  });

  it("يحسب حالة المحاولة بالقاعدة نفسها: خطأ يسبق التوقف", async () => {
    const sink = memoryFileSink();
    await appendTurn(sink, "sessions/folder-one", meta, {
      ...turnData,
      attemptId: "at-err",
      results: [{ targetId: "t1", text: "", usage: null }, { targetId: "t2", text: "", usage: null }],
      prompts: [
        { targetId: "t1", providerId: "openrouter" as const, modelId: "gpt-4o", text: "سؤال", hasShared: true, hasCustom: false },
        { targetId: "t2", providerId: "google" as const, modelId: "gemini", text: "سؤال", hasShared: true, hasCustom: false },
      ],
      status: { t1: "error", t2: "stopped" },
      errors: { t1: "فشل" },
    });
    const report = await recoverFromDisk(sink, "sessions");
    expect(report.imported[0].turns[0].attempts[0].status).toBe("error");
    expect(report.imported[0].turns[0].status).toBe("error");
  });

  it("يعيد توليد session.md المفقود من المخطط دون الوثوق بنص قديم", async () => {
    const sink = memoryFileSink();
    await appendTurn(sink, "sessions/folder-one", meta, turnData);
    const base = memoryFileSink();
    for (const path of sink.tree()) await base.writeFile(path, await sink.readFile(path));
    await base.writeFile("sessions/folder-one/session.md", "# نص قديم متناقض");
    await base.remove("sessions/folder-one/session.md");
    const report = await recoverFromDisk(base, "sessions");
    expect(report.imported).toHaveLength(1);
    expect(await base.readFile("sessions/folder-one/session.md")).toContain("## تمرّة 1");
  });

  it("يحجر المخطط التالف ويبقي نسخة قابلة للتدقيق", async () => {
    const sink = memoryFileSink();
    await writeSessionMeta(sink, "sessions/broken", meta);
    await sink.writeFile("sessions/broken/meta.json", "{ليس JSON");
    const report = await recoverFromDisk(sink, "sessions", { now: () => 1700 });
    expect(report.imported).toHaveLength(0);
    expect(report.quarantined).toHaveLength(1);
    expect(report.quarantined[0].dir).toContain("quarantine/broken-1700");
    expect(await sink.exists("sessions/broken/meta.json")).toBe(false);
  });

  it("يفشل مغلقًا إذا تعذّرت قراءة الشواهد", async () => {
    const sink = memoryFileSink();
    await appendTurn(sink, "sessions/folder-one", meta, turnData);
    await sink.writeFile("sessions/tombstones/rec-1.json", "{ليس JSON");
    const report = await recoverFromDisk(sink, "sessions");
    expect(report.imported).toHaveLength(0);
    expect(report.errors.join(" ")).toContain("شاهد حذف");
  });

  it("يسجّل خطأ الاستيراد دون حذف المصدر إذا فشل النقل إلى الحجر", async () => {
    const base = memoryFileSink();
    await writeSessionMeta(base, "sessions/broken", meta);
    await base.writeFile("sessions/broken/meta.json", "{ليس JSON");
    const sink: FileSink = {
      ...base,
      async rename() { throw new Error("EPERM: /Users/name/Shura/sessions/broken -> quarantine"); },
    };
    const report = await recoverFromDisk(sink, "sessions", { now: () => 1700 });
    expect(report.imported).toHaveLength(0);
    expect(report.quarantined).toEqual([]);
    expect(report.errors.join(" ")).toContain("EPERM");
    expect(report.errors.join(" ")).not.toContain("/Users/");
    expect(await base.exists("sessions/broken/meta.json")).toBe(true);
  });

  it("يسجّل خطأ مقيدًا إذا فشل قراءة المجلد الجذري", async () => {
    const base = memoryFileSink();
    const sink: FileSink = {
      ...base,
      async readDir(p: string) { if (p === "sessions") throw new Error("EPERM: C:\\Users\\name\\Shura\\sessions"); return base.readDir(p); },
    };
    const report = await recoverFromDisk(sink, "sessions");
    expect(report.imported).toHaveLength(0);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).not.toContain("C:\\Users");
  });

  it("لا يستورد أرشيفًا عليه شاهد حذف على القرص", async () => {
    const sink = memoryFileSink();
    await appendTurn(sink, "sessions/folder-one", meta, turnData);
    await sink.writeFile("sessions/tombstones/rec-1.json", JSON.stringify({ id: "rec-1", deletedAt: 99 }));
    const report = await recoverFromDisk(sink, "sessions");
    expect(report.imported).toHaveLength(0);
    expect(report.skippedTombstoned).toEqual(["rec-1"]);
  });

  it("لا يستورد جلسة محذوفة في قاعدة البيانات", async () => {
    const sink = memoryFileSink();
    await appendTurn(sink, "sessions/folder-one", meta, turnData);
    const report = await recoverFromDisk(sink, "sessions", { isTombstoned: async (id) => id === "rec-1" });
    expect(report.imported).toHaveLength(0);
    expect(report.skippedTombstoned).toEqual(["rec-1"]);
  });

  it("يرفض مخططًا بمعرّف جلسة ناقص أو حالات غير صالحة أو وقت غير منتهي", async () => {
    for (const [index, turns] of [
      [{ turnId: "t", attemptId: "a", attempt: 1, results: [], status: {}, errors: {}, createdAt: 1, dirName: "turns/t01", prompts: [] }],
      [{ id: "t", turnId: "t", attemptId: "a", attempt: 1, results: [{ targetId: "t", text: "x", status: "weird", usage: null }], status: { t: "weird" }, errors: {}, createdAt: 1, dirName: "turns/t01", prompts: [] }],
      [{ id: "t", turnId: "t", attemptId: "a", attempt: 1, results: [], status: {}, errors: {}, createdAt: "soon", dirName: "turns/t01", prompts: [] }],
    ]) {
      const sink = memoryFileSink();
      await sink.writeFile("sessions/x/meta.json", JSON.stringify(brokenManifest(turns)));
      const report = await recoverFromDisk(sink, "sessions", { now: () => 1700 });
      expect(report.imported, "case " + index).toHaveLength(0);
      expect(report.quarantined, "case " + index).toHaveLength(1);
      expect(report.errors, "case " + index).toEqual([]);
    }
  });

  it("يرفض مخططًا ليس turns فيه مصفوفة", async () => {
    const sink = memoryFileSink();
    await sink.writeFile("sessions/x/meta.json", JSON.stringify(brokenManifest({ nope: true })));
    const report = await recoverFromDisk(sink, "sessions", { now: () => 1700 });
    expect(report.quarantined).toHaveLength(1);
  });

  it("يستورد أرشيف v1 ويحوّل modelIds إلى targets فارغة", async () => {
    const sink = memoryFileSink();
    await sink.writeFile("sessions/legacy/meta.json", JSON.stringify({
      meta: { id: "legacy-1", title: "قديم", createdAt: 1, updatedAt: 2, modelIds: ["gpt-4o"], primaryTarget: null, layoutMode: "vertical" },
      turns: [{
        turn: { id: "lt-1", sharedPrompt: "سؤال قديم", customs: {} },
        prompts: [{ targetId: "t1", providerId: "openrouter", modelId: "gpt-4o", text: "سؤال قديم", hasShared: true, hasCustom: false }],
        results: [{ targetId: "t1", text: "جواب قديم", usage: { inputTokens: 1, outputTokens: 2, cachedInputTokens: 0, costUSD: null } }],
        status: { t1: "done" }, errors: {}, createdAt: 5, dirName: "turns/t01",
      }],
    }));
    const report = await recoverFromDisk(sink, "sessions");
    expect(report.imported).toHaveLength(1);
    expect(report.imported[0].meta.targets).toEqual([]);
    expect(report.imported[0].meta.onDisk).toBe(true);
    expect(report.imported[0].meta.onDiskDir).toBe("legacy");
    expect(report.imported[0].turns[0].attempts[0].id).toBe("legacy:lt-1:turns/t01");
    expect(report.imported[0].messages.some((m) => m.text === "جواب قديم")).toBe(true);
  });

  it("يعيد بناء رسالة خلاصة بنصها واستهلاكها دون اختلاق مزوّد", async () => {
    const sink = memoryFileSink();
    await appendTurn(sink, "sessions/sum", meta, {
      turn: { id: "syn-1", sharedPrompt: "نص الخلاصة", customs: {} },
      prompts: [],
      results: [{ targetId: "m9", text: "نص الخلاصة", usage: { inputTokens: 3, outputTokens: 2, cachedInputTokens: 0, costUSD: null } }],
      status: { m9: "done" },
      errors: {},
      createdAt: 30,
      attemptId: "at-sum",
      kind: "summary",
    });
    const report = await recoverFromDisk(sink, "sessions");
    const synth = report.imported[0].messages.find((m) => m.kind === "synthesis");
    expect(synth?.text).toBe("نص الخلاصة");
    expect(synth?.status).toBe("done");
    expect(synth?.usage?.inputTokens).toBe(3);
    expect(report.imported[0].messages.filter((m) => m.role === "user")).toHaveLength(0);
  });
});
