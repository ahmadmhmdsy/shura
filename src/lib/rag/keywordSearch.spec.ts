import { describe, expect, it } from "vitest";
import { bm25Search, tokenize } from "./keywordSearch";

describe("tokenize", () => {
  it("يحوّل إلى أحرف صغيرة ويقسّم على غير الحروف والأرقام", () => {
    expect(tokenize("Hello, World 123")).toEqual(["hello", "world", "123"]);
  });

  it("يتعامل مع النص العربي", () => {
    expect(tokenize("مرحبا بالعالم!")).toEqual(["مرحبا", "بالعالم"]);
  });

  it("يتجاهل الرموز والمسافات المتكررة", () => {
    expect(tokenize("  ---  ")).toEqual([]);
    expect(tokenize("")).toEqual([]);
  });
});

describe("bm25Search", () => {
  it("يعيد مصفوفة فارغة عند عدم وجود مستندات", () => {
    expect(bm25Search("مرحبا", [])).toEqual([]);
  });

  it("يعيد مصفوفة فارغة عندما لا يحتوي الاستعلام على أي مصطلح", () => {
    const docs = [{ id: "d1", text: "apple banana" }];
    expect(bm25Search("!!! ???", docs)).toEqual([]);
  });

  it("يستبعد المستندات التي لا تحتوي على أي مصطلح من الاستعلام", () => {
    const docs = [
      { id: "d1", text: "apple banana" },
      { id: "d2", text: "cherry grape" },
    ];
    const results = bm25Search("apple", docs);

    expect(results.map((r) => r.id)).toEqual(["d1"]);
  });

  it("يعيد مصفوفة فارغة عندما تكون جميع المستندات فارغة", () => {
    const docs = [
      { id: "d1", text: "" },
      { id: "d2", text: "   " },
    ];
    expect(bm25Search("apple", docs)).toEqual([]);
  });

  it("يرتّب المستندات حسب تكرار المصطلح (tf)", () => {
    const docs = [
      { id: "d1", text: "apple apple apple" },
      { id: "d2", text: "apple banana" },
    ];
    const results = bm25Search("apple", docs);

    expect(results.map((r) => r.id)).toEqual(["d1", "d2"]);
    expect(results[0].score).toBeGreaterThan(results[1].score);
    // قيمة محسوبة يدويًا وفق معادلة BM25 الموثّقة في الوحدة
    expect(results[0].score).toBeCloseTo(0.2747, 3);
    expect(results[1].score).toBeCloseTo(0.1986, 3);
  });

  it("يمنح مصطلحًا نادرًا وزن IDF أعلى من مصطلح شائع", () => {
    const docs = [
      { id: "d1", text: "apple rare" },
      { id: "d2", text: "apple common" },
      { id: "d3", text: "apple common" },
    ];

    const rare = bm25Search("rare", docs);
    const common = bm25Search("common", docs);

    expect(rare).toHaveLength(1);
    expect(common).toHaveLength(2);
    expect(rare[0].score).toBeGreaterThan(common[0].score);
  });

  it("يحدّ النتائج بعدد k", () => {
    const docs = [
      { id: "d1", text: "apple" },
      { id: "d2", text: "apple" },
      { id: "d3", text: "apple" },
    ];
    expect(bm25Search("apple", docs, 2)).toHaveLength(2);
    expect(bm25Search("apple", docs, 0)).toEqual([]);
  });

  it("يجمع تكرار المصطلح المكرر في الاستعلام", () => {
    const docs = [{ id: "d1", text: "apple" }];
    const single = bm25Search("apple", docs);
    const doubled = bm25Search("apple apple", docs);

    expect(doubled[0].score).toBeCloseTo(single[0].score * 2, 6);
  });

  it("يعمل مع نص عربي", () => {
    const docs = [
      { id: "d1", text: "الشورى هي مبدأ إسلامي" },
      { id: "d2", text: "الطقس اليوم جميل" },
    ];
    const results = bm25Search("الشورى", docs);

    expect(results.map((r) => r.id)).toEqual(["d1"]);
  });

  it("يعيد قائمة مرتبة تنازليًا عبر عدة مصطلحات", () => {
    const docs = [
      { id: "d1", text: "alpha beta" },
      { id: "d2", text: "alpha alpha alpha" },
      { id: "d3", text: "beta" },
    ];
    const results = bm25Search("alpha beta", docs);

    const scores = results.map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(results.length).toBeGreaterThan(1);
  });
});
