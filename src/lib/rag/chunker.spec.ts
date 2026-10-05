import { describe, expect, it } from "vitest";
import { CHUNKING_PRESETS, chunkText } from "./chunker";

describe("chunkText", () => {
  it("يعيد مصفوفة فارغة للنص الفارغ أو المسافات فقط", () => {
    expect(chunkText("", { chunkSize: 100, overlap: 10 })).toEqual([]);
    expect(chunkText("   \n\n  \n\n ", { chunkSize: 100, overlap: 10 })).toEqual([]);
  });

  it("يحتفظ بالفقرة القصيرة كقطعة واحدة مع فهارس البداية والنهاية", () => {
    const paragraph = "مرحبا بالعالم";
    const chunks = chunkText(paragraph, { chunkSize: 100, overlap: 10 });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(paragraph);
    expect(chunks[0].startIndex).toBe(0);
    expect(chunks[0].endIndex).toBe(paragraph.length);
  });

  it("يعالج كل فقرة على حدة عندما تكون جميعها أصغر من الحد", () => {
    const chunks = chunkText("first paragraph\n\nsecond paragraph", {
      chunkSize: 100,
      overlap: 10,
    });

    expect(chunks.map((c) => c.text)).toEqual(["first paragraph", "second paragraph"]);
  });

  it("يشذّب نص القطعة مع إبقاء endIndex على طول الفقرة الأصلية", () => {
    const raw = "  مرحبا  ";
    const chunks = chunkText(raw, { chunkSize: 100, overlap: 10 });

    expect(chunks[0].text).toBe("مرحبا");
    expect(chunks[0].endIndex).toBe(raw.length);
  });

  it("يقسّم الفقرة الطويلة على الجمل ويضيف تداخلًا بين القطع", () => {
    const chunks = chunkText("aaaa bbbb. cccc dddd. eeee ffff.", {
      chunkSize: 5,
      overlap: 1,
    });

    expect(chunks.map((c) => c.text)).toEqual([
      "aaaa bbbb. cccc dddd.",
      "cccc dddd. eeee ffff.",
    ]);
  });

  it("يقسّم الجملة الأطول من الحد إلى كلمات مع تداخل كلمة واحدة", () => {
    const chunks = chunkText("aaaa bbbb cccc dddd eeee", { chunkSize: 4, overlap: 4 });

    expect(chunks.map((c) => c.text)).toEqual(["aaaa bbbb cccc dddd", "dddd eeee"]);
  });

  it("يفرّغ القطعة المتراكمة قبل تقسيم الجملة الطويلة بالكلمات", () => {
    const chunks = chunkText("aa bb. aaaa bbbb cccc dddd eeee", {
      chunkSize: 4,
      overlap: 4,
    });

    expect(chunks.map((c) => c.text)).toEqual([
      "aa bb.",
      "aaaa bbbb cccc dddd",
      "dddd eeee",
    ]);
  });

  it("يعالج فقرات مختلطة: القصيرة تُحفظ كاملة والطويلة تُقسَّم", () => {
    const chunks = chunkText("short one\n\naaaa bbbb. cccc dddd. eeee ffff.", {
      chunkSize: 5,
      overlap: 1,
    });

    expect(chunks.map((c) => c.text)).toEqual([
      "short one",
      "aaaa bbbb. cccc dddd.",
      "cccc dddd. eeee ffff.",
    ]);
  });

  it("يقسّم على علامات الترقيم العربية أيضًا", () => {
    const chunks = chunkText("مرحبا بك؟ أهلا وسهلا！ نهاية。", {
      chunkSize: 3,
      overlap: 1,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.text.length > 0)).toBe(true);
  });

  // انحدار: overlap = 0 يعني «بلا تداخل». قبل الإصلاح كان Math.ceil(0 / 4) = 0 و
  // slice(-0) === slice(0) فينسخ القطعة السابقة كاملة وتتجاوز القطعة التالية حد chunkSize.
  it("overlap = 0 في تقسيم الكلمات: بلا تداخل ولا تجاوز لحد chunkSize", () => {
    const chunks = chunkText("aaaa bbbb cccc dddd eeee", { chunkSize: 4, overlap: 0 });

    expect(chunks.map((c) => c.text)).toEqual(["aaaa bbbb cccc dddd", "eeee"]);
  });

  it("overlap = 0 في تقسيم الجمل: بلا تداخل", () => {
    const chunks = chunkText("aaaa bbbb. cccc dddd. eeee ffff.", {
      chunkSize: 5,
      overlap: 0,
    });

    expect(chunks.map((c) => c.text)).toEqual(["aaaa bbbb. cccc dddd.", "eeee ffff."]);
  });
});

describe("CHUNKING_PRESETS", () => {
  it("يوفّر الإعدادات الجاهزة الثلاث بالقيم المتوقعة", () => {
    expect(CHUNKING_PRESETS.balanced).toEqual({ chunkSize: 500, overlap: 100 });
    expect(CHUNKING_PRESETS.precise).toEqual({ chunkSize: 300, overlap: 50 });
    expect(CHUNKING_PRESETS.contextual).toEqual({ chunkSize: 800, overlap: 150 });
  });

  it("كل الإعدادات الجاهزة قابلة للاستخدام مع chunkText", () => {
    for (const preset of Object.values(CHUNKING_PRESETS)) {
      const chunks = chunkText("نص قصير للاختبار", preset);
      expect(chunks).toHaveLength(1);
    }
  });
});
