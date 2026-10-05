import { describe, expect, it } from "vitest";
import { hybridSearch, rrfFusion, type SearchResult } from "./hybridSearch";

const res = (id: string, score = 1): SearchResult => ({ id, score });

describe("rrfFusion", () => {
  it("يعيد مصفوفة فارغة عند عدم وجود قوائم", () => {
    expect(rrfFusion([])).toEqual([]);
    expect(rrfFusion([[], []])).toEqual([]);
  });

  it("يحسب الدرجة بمعامل k الافتراضي 60 حسب الرتبة", () => {
    const fused = rrfFusion([[res("a"), res("b")]]);

    expect(fused.map((r) => r.id)).toEqual(["a", "b"]);
    expect(fused[0].score).toBeCloseTo(1 / 61, 10);
    expect(fused[1].score).toBeCloseTo(1 / 62, 10);
  });

  it("يجمع درجات المستند نفسه عبر القوائم المتعددة", () => {
    const fused = rrfFusion([[res("a")], [res("a")]]);

    expect(fused).toHaveLength(1);
    expect(fused[0].score).toBeCloseTo(2 / 61, 10);
  });

  it("يرتّب المستندات الظاهرة في قائمتين قبل الظاهرة في قائمة واحدة", () => {
    const fused = rrfFusion([[res("only-semantic")], [res("only-keyword")], [res("only-keyword")]]);

    expect(fused.map((r) => r.id)).toEqual(["only-keyword", "only-semantic"]);
  });

  it("يجمع تكرار المعرّف نفسه داخل القائمة الواحدة", () => {
    const fused = rrfFusion([[res("a"), res("a")]]);

    expect(fused).toHaveLength(1);
    expect(fused[0].score).toBeCloseTo(1 / 61 + 1 / 62, 10);
  });

  it("يحترم قيمة k المخصّصة", () => {
    const fused = rrfFusion([[res("a")]], 0);

    expect(fused[0].score).toBeCloseTo(1, 10);
  });

  it("يرتّب تنازليًا حسب الدرجة المجمّعة", () => {
    const fused = rrfFusion([[res("a"), res("b"), res("c")], [res("c")]]);

    const scores = fused.map((r) => r.score);
    expect(scores).toEqual([...scores].sort((x, y) => y - x));
    expect(fused[0].id).toBe("c");
  });
});

describe("hybridSearch", () => {
  it("يدمج النتائج الدلالية والكلمات المفتاحية", () => {
    const results = hybridSearch([res("s1"), res("s2")], [res("k1"), res("s1")]);

    expect(results.map((r) => r.id)).toEqual(["s1", "k1", "s2"]);
  });

  it("يقتصر على topK", () => {
    const results = hybridSearch([res("s1"), res("s2"), res("s3")], [res("k1")], 2);

    expect(results).toHaveLength(2);
  });

  it("يعيد مصفوفة فارغة عندما تكون القائمتان فارغتين", () => {
    expect(hybridSearch([], [])).toEqual([]);
  });

  it("يتجاهل الدرجات الأصلية ويعتمد على الرتب فقط", () => {
    const byScore = hybridSearch([res("a", 0.1), res("b", 999)], []);
    const byRank = hybridSearch([res("a", 999), res("b", 0.1)], []);

    expect(byScore[0].id).toBe("a");
    expect(byRank[0].id).toBe("a");
  });

  it("يعيد كل النتائج عندما يكون topK أكبر من عددها", () => {
    const results = hybridSearch([res("s1")], [res("k1")], 100);

    expect(results).toHaveLength(2);
  });
});
