import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchCache, searchCache, type CacheKey, type CacheEntry } from "./searchCache";

const key = (over: Partial<CacheKey> = {}): CacheKey => ({
  query: "ما هي الشورى؟",
  mode: "hybrid",
  scope: "all",
  ...over,
});

const results = (id: string): CacheEntry["results"] => [
  { chunkId: id, text: "نص", score: 1, source: "a.txt", documentId: "doc1" },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SearchCache", () => {
  it("يبدأ فارغًا", () => {
    const cache = new SearchCache();
    expect(cache.size).toBe(0);
    expect(cache.get(key())).toBeUndefined();
  });

  it("يخزّن النتائج ويعيدها بنفس المفتاح", () => {
    const cache = new SearchCache();
    cache.set(key(), results("c1"));

    const entry = cache.get(key());
    expect(entry?.results).toEqual(results("c1"));
    expect(entry?.timestamp).toBeTypeOf("number");
    expect(cache.size).toBe(1);
  });

  it("يميّز المفاتيح حسب الاستعلام والنمط والنطاق", () => {
    const cache = new SearchCache();
    cache.set(key(), results("c1"));

    expect(cache.get(key({ query: "سؤال آخر" }))).toBeUndefined();
    expect(cache.get(key({ mode: "keyword" }))).toBeUndefined();
    expect(cache.get(key({ scope: "uploads" }))).toBeUndefined();
    expect(cache.size).toBe(1);
  });

  it("يستبدل القيمة عند الكتابة على المفتاح نفسه", () => {
    const cache = new SearchCache();
    cache.set(key(), results("c1"));
    cache.set(key(), results("c2"));

    expect(cache.size).toBe(1);
    expect(cache.get(key())?.results[0].chunkId).toBe("c2");
  });

  it("يمسح كل المدخلات", () => {
    const cache = new SearchCache();
    cache.set(key(), results("c1"));
    cache.set(key({ query: "ثانٍ" }), results("c2"));
    expect(cache.size).toBe(2);

    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.get(key())).toBeUndefined();
  });

  it("يعتبر المدخل صالحًا عند حد الخمس دقائق بالضبط", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const cache = new SearchCache();
    cache.set(key(), results("c1"));

    now.mockReturnValue(1_000_000 + 5 * 60 * 1000);
    expect(cache.get(key())).toBeDefined();
    expect(cache.size).toBe(1);
  });

  it("يحذف المدخل المنتهي بعد تجاوز الخمس دقائق", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const cache = new SearchCache();
    cache.set(key(), results("c1"));

    now.mockReturnValue(1_000_000 + 5 * 60 * 1000 + 1);

    expect(cache.get(key())).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("يعيد undefined للمفتاح غير المخزَّن دون التأثير على الحجم", () => {
    const cache = new SearchCache();
    cache.set(key(), results("c1"));

    expect(cache.get(key({ query: "غير مخزَّن" }))).toBeUndefined();
    expect(cache.size).toBe(1);
  });

  it("يوفّر نسخة عامة واحدة قابلة للاستخدام", () => {
    expect(searchCache).toBeInstanceOf(SearchCache);
    searchCache.set(key(), results("global"));
    expect(searchCache.get(key())?.results[0].chunkId).toBe("global");
    searchCache.clear();
    expect(searchCache.size).toBe(0);
  });
});
