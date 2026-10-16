import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { uiText } from "@/i18n";
import { memoryFileSink } from "./sink";
import { appendTurn, sessionFolderName, usageRow, writeSessionMeta } from "./writer";
import { UNKNOWN_COST, formatCost } from "@/lib/usage/cost";

const meta = { id: "ab12cd34", title: "سؤال عن المنتج X", createdAt: Date.parse("2026-09-05T10:00:00Z"), updatedAt: Date.parse("2026-09-05T10:00:00Z"), modelIds: ["openai/gpt-4o", "gemini-2.5-pro"], primaryTarget: null, layoutMode: "vertical" as const, onDisk: false };

const turnData = {
  turn: { id: "t1", sharedPrompt: "ما مميزات المنتج X؟", customs: {} },
  prompts: [
    { targetId: "t1", providerId: "openrouter" as const, modelId: "openai/gpt-4o", text: "ما مميزات المنتج X؟", hasShared: true, hasCustom: false },
    { targetId: "t2", providerId: "google" as const, modelId: "gemini-2.5-pro", text: "ما مميزات المنتج X؟", hasShared: true, hasCustom: false },
  ],
  results: [
    { targetId: "t1", text: "جواب GPT هنا", usage: { inputTokens: 12, outputTokens: 30, cachedInputTokens: 0, costUSD: 0.0003 } },
    { targetId: "t2", text: "جواب Gemini هنا", usage: { inputTokens: 12, outputTokens: 25, cachedInputTokens: 4, costUSD: null } },
  ],
  status: { t1: "done", t2: "error" } as Record<string, string>,
  errors: { t2: "مفتاح غير صالح" } as Record<string, string>,
  createdAt: Date.parse("2026-09-05T10:01:00Z"),
};

beforeEach(() => { memoryFileSink().reset(); });

describe("markdown writer", () => {
  it("اسم المجلد يُنظف من محارف Windows المحظورة", () => {
    expect(sessionFolderName("سؤال: <X> | “يوم” ؟", "ab12cd34", 0)).toMatch(/^\d{4}-\d{2}-\d{2}_سؤال-X-“يوم”-؟_/);
    expect(sessionFolderName("عنوان/ممنوع\\ا", "id", 0)).not.toMatch(/[<>:"/\\|?*]/);
  });
  it("appendTurn يكتب session.md وmeta.json وملفًا لكل نتيجة", async () => {
    const sink = memoryFileSink();
    const dir = "sessions/2026-09-05_سؤال-عن-المنتج-X_ab12cd34";
    await appendTurn(sink, dir, meta, turnData);
    const sessionMd = await sink.readFile(dir + "/session.md");
    expect(sessionMd).toContain("# جلسة: سؤال عن المنتج X");
    expect(sessionMd).toContain("## تمرّة 1");
    expect(sessionMd).toContain("> ما مميزات المنتج X؟");
    expect(sessionMd).toContain("### openrouter — openai/gpt-4o");
    expect(sessionMd).toContain("جواب GPT هنا");
    expect(sessionMd).toContain("| المدخلات | 12 |");
    expect(sessionMd).toContain("⛔ مفتاح غير صالح");
    expect(await sink.exists(dir + "/turns/t01/00_shared-prompt.md")).toBe(true);
    expect(await sink.exists(dir + "/turns/t01/01_openrouter__openai_gpt-4o.md")).toBe(true);
    expect(await sink.readFile(dir + "/turns/t01/01_openrouter__openai_gpt-4o.md")).toContain("جواب GPT هنا");
    const metaJson = JSON.parse(await sink.readFile(dir + "/meta.json"));
    expect(metaJson.meta.id).toBe("ab12cd34");
    expect(metaJson.turns[0].results[1].text).toBe("جواب Gemini هنا");
  });
  it("appendTurn مرتين يرقّم التمرّتين t01 ثم t02 ويلاحق session.md", async () => {
    const sink = memoryFileSink();
    const dir = "sessions/x";
    await appendTurn(sink, dir, meta, turnData);
    await appendTurn(sink, dir, meta, { ...turnData, turn: { ...turnData.turn, id: "t2" }, createdAt: turnData.createdAt + 1 });
    const md = await sink.readFile(dir + "/session.md");
    expect(md).toContain("## تمرّة 2");
    expect((md.match(/## تمرّة/g) || []).length).toBe(2);
    expect(await sink.exists(dir + "/turns/t02/00_shared-prompt.md")).toBe(true);
  });
});

describe("writeSessionMeta", () => {
  it("يكتب meta.json أوليًا", async () => {
    const sink = memoryFileSink();
    await writeSessionMeta(sink, "sessions/x", meta);
    const parsed = JSON.parse(await sink.readFile("sessions/x/meta.json"));
    expect(parsed.meta.title).toBe("سؤال عن المنتج X");
    expect(parsed.turns).toEqual([]);
  });
});

describe("المهمة 5 — أرشفة خطأ بنص جزئي", () => {
  it("يقتطع خطأ الرموز غير النقاطية بعدد محارف Unicode دون قطع زوج بديل", async () => {
    const sink = memoryFileSink();
    const dir = "sessions/astral-error";
    const marker = "… [مقتطع]";
    const normalized = "😀".repeat(600);
    const expectedError = [...normalized].slice(0, 512 - [...marker].length).join("") + marker;
    await appendTurn(sink, dir, meta, {
      ...turnData,
      results: [{ targetId: "t2", text: "نص جزئي", usage: null }],
      status: { t2: "error" },
      errors: { t2: normalized },
    });
    const md = await sink.readFile(dir + "/session.md");
    const resultFile = await sink.readFile(dir + "/turns/t01/01_google__gemini-2.5-pro.md");
    const archived = JSON.parse(await sink.readFile(dir + "/meta.json")).turns[0];
    expect([...expectedError]).toHaveLength(512);
    expect(md).toContain("⛔ " + expectedError);
    expect(resultFile).toContain("⛔ " + expectedError);
    expect(archived.errors.t2).toBe(expectedError);
  });

  it("نص الخطأ الطويل يُطبّع ويُقتطع إلى 512 محرفًا بالعلامة نفسها في Markdown والملف الفرعي وmeta.json", async () => {
    const sink = memoryFileSink();
    const dir = "sessions/long-error";
    const marker = "… [مقتطع]";
    const normalized = ("أول   الخطأ\n" + "ب".repeat(600) + "نهاية-الخطأ-الطويل").replace(/\s+/g, " ").trim();
    const expectedError = [...normalized].slice(0, 512 - [...marker].length).join("") + marker;
    await appendTurn(sink, dir, meta, {
      ...turnData,
      results: [{ targetId: "t2", text: "نص جزئي", usage: null }],
      status: { t2: "error" },
      errors: { t2: "  " + normalized + "  " },
    });
    const md = await sink.readFile(dir + "/session.md");
    const resultFile = await sink.readFile(dir + "/turns/t01/01_google__gemini-2.5-pro.md");
    const archived = JSON.parse(await sink.readFile(dir + "/meta.json")).turns[0];
    expect([...expectedError]).toHaveLength(512);
    expect(md).toContain("⛔ " + expectedError);
    expect(resultFile).toContain("⛔ " + expectedError);
    expect(archived.errors.t2).toBe(expectedError);
    expect(md).not.toContain("نهاية-الخطأ-الطويل");
    expect(resultFile).not.toContain("نهاية-الخطأ-الطويل");
  });

  it("خطأ أبيض أو فارغ يبقى فارغًا متطابقًا في Markdown والملف الفرعي وmeta.json", async () => {
    const sink = memoryFileSink();
    const dir = "sessions/empty-error";
    await appendTurn(sink, dir, meta, {
      ...turnData,
      results: [{ targetId: "t2", text: "نص جزئي", usage: null }],
      status: { t2: "error" },
      errors: { t2: " \n\t  " },
    });
    const md = await sink.readFile(dir + "/session.md");
    const resultFile = await sink.readFile(dir + "/turns/t01/01_google__gemini-2.5-pro.md");
    const archived = JSON.parse(await sink.readFile(dir + "/meta.json")).turns[0];
    expect(md).toContain("⛔ \n");
    expect(resultFile).toContain("⛔ \n");
    expect(archived.errors.t2).toBe("");
    expect(md).not.toContain("⛔ خطأ");
    expect(resultFile).not.toContain("⛔ خطأ");
  });

  it("خطأ بنص جزئي: يحفظ النص الجزئي ويظهر الخطأ المحدود أيضًا في session.md والملف الفرعي", async () => {
    const sink = memoryFileSink();
    const dir = "sessions/partial-err";
    await appendTurn(sink, dir, meta, {
      ...turnData,
      results: [{ targetId: "t2", text: "نص جزئي واصل قبل الانقطاع", usage: null }],
      status: { t2: "error" },
      errors: { t2: "انقطع الاتصال بالبث" },
    });
    const md = await sink.readFile(dir + "/session.md");
    // النص الجزئي لا يُمحى، والخطأ المحدود يُظهر بجانبه
    expect(md).toContain("نص جزئي واصل قبل الانقطاع");
    expect(md).toContain("⛔ انقطع الاتصال بالبث");
    const sub = await sink.readFile(dir + "/turns/t01/01_google__gemini-2.5-pro.md");
    expect(sub).toContain("نص جزئي واصل قبل الانقطاع");
    expect(sub).toContain("⛔ انقطع الاتصال بالبث");
  });
});
// ===== Task 7: manifest v2, atomic publication, serialization, idempotency =====

import type { FileSink } from "./sink";

function recordingSink(base: FileSink, calls: string[]) {
  return {
    ...base,
    async writeFile(p: string, c: string) { calls.push("write:" + p); await base.writeFile(p, c); },
    async rename(a: string, b: string) { calls.push("rename:" + a + "->" + b); await base.rename(a, b); },
  } as FileSink;
}

function failingSink(base: FileSink, fail: (op: string, path: string) => boolean) {
  return {
    ...base,
    async writeFile(p: string, c: string) { if (fail("write", p)) throw new Error("EIO: " + p); await base.writeFile(p, c); },
    async rename(a: string, b: string) { if (fail("rename", a)) throw new Error("EIO: " + a); await base.rename(a, b); },
    async ensureDir(p: string) { if (fail("ensureDir", p)) throw new Error("EIO: " + p); await base.ensureDir(p); },
  } as FileSink;
}

const dir = "sessions/atomic";

describe("manifest v2", () => {
  it("writeSessionMeta ينشر meta.json بمخطط 2 عبر ملف مؤقت", async () => {
    const base = memoryFileSink();
    const calls: string[] = [];
    await writeSessionMeta(recordingSink(base, calls), dir, meta);
    const parsed = JSON.parse(await base.readFile(dir + "/meta.json"));
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.turns).toEqual([]);
    expect(parsed.meta.id).toBe("ab12cd34");
    expect(calls).toContain("rename:" + dir + "/meta.json.tmp->" + dir + "/meta.json");
    expect(await base.exists(dir + "/meta.json.tmp")).toBe(false);
  });

  it("يخزّن attempt وkind وoperationId في مدخل الأرشيف", async () => {
    const sink = memoryFileSink();
    await appendTurn(sink, dir, meta, { ...turnData, attemptId: "at-1", attemptNumber: 2, kind: "retry", operationId: "op-1" });
    const entry = JSON.parse(await sink.readFile(dir + "/meta.json")).turns[0];
    expect(entry.turnId).toBe("t1");
    expect(entry.attemptId).toBe("at-1");
    expect(entry.attempt).toBe(2);
    expect(entry.kind).toBe("retry");
    expect(entry.operationId).toBe("op-1");
  });

  it("يقبل مخطط v1 غير المرقّم ويحافظ على بياناته ثم يكتب v2", async () => {
    const sink = memoryFileSink();
    await sink.writeFile(dir + "/meta.json", JSON.stringify({
      meta: { id: "old-1", title: "قديم", createdAt: 1, updatedAt: 2, modelIds: ["gpt-4o"], primaryTarget: null, layoutMode: "vertical" },
      turns: [{
        turn: { id: "legacy-turn", sharedPrompt: "سؤال قديم", customs: {} },
        prompts: [{ targetId: "t1", providerId: "openrouter", modelId: "gpt-4o", text: "سؤال قديم", hasShared: true, hasCustom: false }],
        results: [{ targetId: "t1", text: "جواب قديم", usage: { inputTokens: 1, outputTokens: 2, cachedInputTokens: 0, costUSD: null } }],
        status: { t1: "done" }, errors: {}, createdAt: 5, dirName: "turns/t01",
      }],
    }));
    // The legacy folder keeps its old sidecar files; migration never deletes them.
    await sink.writeFile(dir + "/turns/t01/00_shared-prompt.md", "سؤال قديم\n");
    await appendTurn(sink, dir, meta, { ...turnData, turn: { id: "t2", sharedPrompt: "جديد", customs: {} }, attemptId: "at-new" });
    const parsed = JSON.parse(await sink.readFile(dir + "/meta.json"));
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.turns).toHaveLength(2);
    expect(parsed.turns[0].attemptId).toBe("legacy:legacy-turn:turns/t01");
    expect(parsed.turns[0].results[0].text).toBe("جواب قديم");
    expect(parsed.turns[0].results[0].usage.inputTokens).toBe(1);
    expect(parsed.turns[1].attemptId).toBe("at-new");
    expect(await sink.readFile(dir + "/turns/t01/00_shared-prompt.md")).toBe("سؤال قديم\n");
  });

  it("يرفض مدخلًا بحالة غير صالحة بدل نشره", async () => {
    const sink = memoryFileSink();
    const broken = {
      schemaVersion: 2,
      meta,
      updatedAt: 1,
      turns: [{ id: "t1", turnId: "t1", attemptId: "a", attempt: 1, kind: "send", dirName: "turns/t01", sharedPrompt: null, prompts: [], results: [{ targetId: "t1", text: "x", status: "bogus", usage: null }], status: { t1: "bogus" }, errors: {}, createdAt: 1 }],
    };
    await sink.writeFile(dir + "/meta.json", JSON.stringify(broken));
    await expect(appendTurn(sink, dir, meta, { ...turnData, attemptId: "at-new" })).rejects.toThrow();
  });
});


// [T3.3/D3] طابع الوقت في session.md يأتي من مُنسِّق التطبيق (uiText.formatDate) فيتبع اللغة
// النشطة، بدل `toLocaleString("ar")` الثابتة التي كانت تكتب العربية حتى لمن اختار الإنجليزية.
describe("archive timestamp follows the active locale (T3.3)", () => {
  const ts = Date.parse("2026-09-05T10:01:00Z");
  const fmt: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "medium" };
  const write = async (dir: string) => {
    const sink = memoryFileSink();
    await appendTurn(sink, dir, meta, { ...turnData, createdAt: ts, attemptId: "at-locale" });
    return sink.readFile(dir + "/session.md");
  };
  afterEach(() => uiText.setLocale("ar"));

  it("بالإنجليزية يظهر الطابع الإنجليزي لا العربي", async () => {
    uiText.setLocale("en");
    const md = await write("sessions/t33-en_ab12cd34");
    expect(md).toContain(uiText.formatDate(ts, fmt));
    uiText.setLocale("ar");
    expect(md).not.toContain(uiText.formatDate(ts, fmt));
  });

  it("وبالعربية يظهر الطابع العربي بلا تغيير مرئي", async () => {
    uiText.setLocale("ar");
    const md = await write("sessions/t33-ar_ab12cd34");
    expect(md).toContain(uiText.formatDate(ts, fmt));
  });
});

describe("atomic publication", () => {
  it("لا ينشر التمريرة عند فشل ملف نتيجة ويحفظ المخطط السابق", async () => {
    const base = memoryFileSink();
    await appendTurn(base, dir, meta, { ...turnData, turn: { id: "first", sharedPrompt: "الأولى", customs: {} }, attemptId: "at-1" });
    const before = await base.readFile(dir + "/meta.json");
    const sink = failingSink(base, (op, p) => op === "write" && p.includes("02_"));
    await expect(appendTurn(sink, dir, meta, { ...turnData, turn: { id: "second", sharedPrompt: "الثانية", customs: {} }, attemptId: "at-2" })).rejects.toThrow();
    expect(await base.readFile(dir + "/meta.json")).toBe(before);
    expect(JSON.parse(before).turns).toHaveLength(1);
    expect((await base.tree()).filter((p) => p.includes(".tmp"))).toEqual([]);
  });

  it("يحفظ المخطط السابق إذا فشل تغيير اسم meta.json", async () => {
    const base = memoryFileSink();
    await appendTurn(base, dir, meta, { ...turnData, turn: { id: "first", sharedPrompt: "الأولى", customs: {} }, attemptId: "at-1" });
    const before = await base.readFile(dir + "/meta.json");
    const sink = failingSink(base, (op, p) => op === "rename" && p.includes("meta.json.tmp"));
    await expect(appendTurn(sink, dir, meta, { ...turnData, turn: { id: "second", sharedPrompt: "الثانية", customs: {} }, attemptId: "at-2" })).rejects.toThrow();
    expect(await base.readFile(dir + "/meta.json")).toBe(before);
  });

  it("ينشر session.md قبل meta.json كعلامة التزام", async () => {
    const base = memoryFileSink();
    const calls: string[] = [];
    await appendTurn(recordingSink(base, calls), dir, meta, { ...turnData, attemptId: "at-1" });
    const md = calls.findIndex((c) => c.includes("session.md.tmp->"));
    const metaRename = calls.findIndex((c) => c.includes("meta.json.tmp->"));
    expect(md).toBeGreaterThanOrEqual(0);
    expect(metaRename).toBeGreaterThan(md);
  });

  it("يولّد session.md من المخطط ويتجاهل نصًا قديمًا متناقضًا", async () => {
    const base = memoryFileSink();
    await appendTurn(base, dir, meta, { ...turnData, turn: { id: "first", sharedPrompt: "الأولى", customs: {} }, attemptId: "at-1" });
    await base.writeFile(dir + "/session.md", "# نص قديم متناقض\n\n## تمرّة 99\nنص لم يُكتب يومًا");
    await appendTurn(base, dir, meta, { ...turnData, turn: { id: "second", sharedPrompt: "الثانية", customs: {} }, attemptId: "at-2" });
    const md = await base.readFile(dir + "/session.md");
    expect(md).not.toContain("نص قديم متناقض");
    expect(md).not.toContain("## تمرّة 99");
    expect(md).toContain("## تمرّة 1");
    expect(md).toContain("## تمرّة 2");
  });
});

describe("serialization and idempotency", () => {
  it("يسلسل إضافتين متزامنتين لنفس المجلد دون فقدان", async () => {
    const sink = memoryFileSink();
    await Promise.all([
      appendTurn(sink, dir, meta, { ...turnData, turn: { id: "a", sharedPrompt: "أ", customs: {} }, attemptId: "at-a" }),
      appendTurn(sink, dir, meta, { ...turnData, turn: { id: "b", sharedPrompt: "ب", customs: {} }, attemptId: "at-b" }),
    ]);
    const parsed = JSON.parse(await sink.readFile(dir + "/meta.json"));
    expect(parsed.turns.map((t: { attemptId: string }) => t.attemptId).sort()).toEqual(["at-a", "at-b"]);
    expect(parsed.turns.map((t: { dirName: string }) => t.dirName).sort()).toEqual(["turns/t01", "turns/t02"]);
  });

  it("نفس attemptId متكرر لا يكرر المدخل ولا المجلد", async () => {
    const sink = memoryFileSink();
    await appendTurn(sink, dir, meta, { ...turnData, attemptId: "at-1" });
    await appendTurn(sink, dir, meta, { ...turnData, attemptId: "at-1" });
    const parsed = JSON.parse(await sink.readFile(dir + "/meta.json"));
    expect(parsed.turns).toHaveLength(1);
    // 00_shared-prompt.md plus one result file per target: no second attempt directory.
    expect((await sink.tree()).filter((p) => p.includes("/turns/"))).toHaveLength(3);
  });

  it("مدخل بنفس attemptId وبيانات مختلفة يرفض بدل استبدال المُلتزَم", async () => {
    const sink = memoryFileSink();
    await appendTurn(sink, dir, meta, { ...turnData, attemptId: "at-1" });
    await expect(appendTurn(sink, dir, meta, {
      ...turnData,
      attemptId: "at-1",
      results: [{ targetId: "t1", text: "نص مختلف تمامًا", usage: null }],
      status: { t1: "done" },
      errors: {},
    })).rejects.toThrow();
    const parsed = JSON.parse(await sink.readFile(dir + "/meta.json"));
    expect(parsed.turns).toHaveLength(1);
    expect(parsed.turns[0].results[0].text).toBe("جواب GPT هنا");
  });

  it("يرفض إضافة جديدة بعد وجود شاهد حذف على القرص", async () => {
    const sink = memoryFileSink();
    await sink.writeFile("sessions/tombstones/ab12cd34.json", JSON.stringify({ id: "ab12cd34", deletedAt: 1 }));
    await expect(appendTurn(sink, dir, meta, { ...turnData, attemptId: "at-1" })).rejects.toThrow();
    expect(await sink.exists(dir + "/meta.json")).toBe(false);
  });
});

// [T3.4/LV-07] صفّ الاستهلاك في الأرشيف يستعمل المساعد نفسه وعلامة المجهول نفسها:
describe("usageRow cost (T3.4/LV-07)", () => {
  const usage = { inputTokens: 1, outputTokens: 2, cachedInputTokens: 0, costUSD: null };
  it("السعر المجهول يُكتب بالعلامة المشتركة", () => {
    expect(usageRow(usage)).toContain("| التكلفة | " + UNKNOWN_COST + " |");
  });
  it("والسعر المعروف يخرج من المساعد نفسه", () => {
    expect(usageRow({ ...usage, costUSD: 0.0003 })).toContain(formatCost(0.0003, UNKNOWN_COST));
  });
});
