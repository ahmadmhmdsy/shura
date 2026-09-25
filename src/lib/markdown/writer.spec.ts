import { beforeEach, describe, expect, it } from "vitest";
import { memoryFileSink } from "./sink";
import { appendTurn, sessionFolderName, writeSessionMeta } from "./writer";

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
