import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RagChunk, RagSettings } from "@/types";
import { DEFAULT_RAG_SETTINGS } from "@/types";

const dm = vi.hoisted(() => ({ chunks: [] as RagChunk[], calls: 0 }));

vi.mock("./documentManager", () => ({
  getAllChunks: async () => {
    dm.calls++;
    return dm.chunks;
  },
}));

const emb = vi.hoisted(() => ({
  isLoaded: true,
  loadError: null as Error | null,
  loadCalls: 0,
  embed: vi.fn<(text: string) => Promise<number[]>>(async () => [0.1, 0.2]),
}));

vi.mock("./embedder", () => ({
  EMBEDDING_MODELS: [
    {
      id: "multilingual-e5-small",
      modelId: "multilingual-e5-small",
      label: "Multilingual E5 Small",
      dimensions: 384,
      downloadedAt: 0,
      sizeBytes: 1,
    },
  ],
  OnnxEmbedder: class {
    constructor(
      public readonly modelId: string,
      public readonly dimensions: number,
    ) {}
    embed(text: string) {
      return emb.embed(text);
    }
  },
  isModelLoaded: () => emb.isLoaded,
  loadEmbeddingModel: async () => {
    emb.loadCalls++;
    if (emb.loadError) throw emb.loadError;
    emb.isLoaded = true;
    return {};
  },
}));

const vec = vi.hoisted(() => ({
  results: [] as Array<{ chunkId: string; score: number }>,
  calls: [] as Array<{ query: number[]; k: number }>,
}));

vi.mock("./vectorIndex", () => ({
  getVectorIndex: () => ({
    search: async (query: number[], k: number) => {
      vec.calls.push({ query, k });
      return vec.results;
    },
  }),
}));

import { searchCache } from "./searchCache";
import { clearSearchCache, createSearchDocumentsTool } from "./tool";

const settings = (over: Partial<RagSettings> = {}): RagSettings => ({
  ...DEFAULT_RAG_SETTINGS,
  ...over,
});

const chunk = (id: string, text: string, source = "a.txt"): RagChunk => ({
  id,
  documentId: "doc1",
  chunkIndex: 0,
  text,
  embedding: [0.1],
  metadata: { source, timestamp: 1 },
});

const tool = (over: Partial<RagSettings> = {}) =>
  createSearchDocumentsTool({ settings: settings(over) });

beforeEach(() => {
  searchCache.clear();
  dm.chunks = [];
  dm.calls = 0;
  emb.isLoaded = true;
  emb.loadError = null;
  emb.loadCalls = 0;
  emb.embed.mockClear();
  vec.results = [];
  vec.calls = [];
});

describe("createSearchDocumentsTool", () => {
  it("يعرّف المخطط مع القيم الافتراضية من الإعدادات", () => {
    const searchTool = tool({ defaultSearchMode: "keyword" });

    expect(searchTool.description).toContain("Search through the user's documents");

    const parsed = searchTool.inputSchema.parse({ query: "ما هي الشورى؟" });
    expect(parsed).toEqual({ query: "ما هي الشورى؟", search_mode: "keyword", scope: "all" });

    const explicit = searchTool.inputSchema.parse({
      query: "x",
      search_mode: "semantic",
      scope: "uploads",
    });
    expect(explicit.search_mode).toBe("semantic");
    expect(explicit.scope).toBe("uploads");
  });

  it("يرفض استعلامًا بلا نص", () => {
    expect(() => tool().inputSchema.parse({})).toThrow();
  });
});

describe("execute — بلا مستندات", () => {
  it("يعيد رسالة عربية عندما لا توجد مستندات مفهرسة", async () => {
    const result = await tool().execute({ query: "س", search_mode: "keyword", scope: "all" });

    expect(result).toBe("No documents are indexed yet. The user hasn't uploaded any files.");
  });

  it("لا يستدعي المضمّن في نمط الكلمات المفتاحية", async () => {
    dm.chunks = [chunk("c1", "الشورى مبدأ إسلامي")];

    await tool().execute({ query: "الشورى", search_mode: "keyword", scope: "all" });

    expect(emb.embed).not.toHaveBeenCalled();
  });
});

describe("execute — نمط الكلمات المفتاحية", () => {
  it("يبني نتائج من BM25 ويغلّفها بمحدّدات المصدر", async () => {
    dm.chunks = [chunk("c1", "الشورى مبدأ إسلامي", "shura.txt")];

    const result = await tool().execute({ query: "الشورى", search_mode: "keyword", scope: "all" });

    expect(result).toContain("[BEGIN DOCUMENT: shura.txt, result 1]");
    expect(result).toContain("الشورى مبدأ إسلامي");
    expect(result).toContain("[END DOCUMENT]");
  });

  it("يعيد رسالة عدم وجود نتائج عندما لا يطابق الاستعلام شيئًا", async () => {
    dm.chunks = [chunk("c1", "موضوع آخر تمامًا")];

    const result = await tool().execute({ query: "زززز", search_mode: "keyword", scope: "all" });

    expect(result).toBe("No relevant documents found.");
  });

  it("يتجاهل النطاق المطلوب ويبحث في كل القطع", async () => {
    dm.chunks = [chunk("c1", "الشورى مبدأ", "a.txt"), chunk("c2", "الشورى أيضًا", "b.txt")];

    const result = await tool().execute({ query: "الشورى", search_mode: "keyword", scope: "uploads" });

    expect(result).toContain("a.txt");
    expect(result).toContain("b.txt");
  });
});

describe("execute — النمط الدلالي", () => {
  it("يضمّن الاستعلام ويحوّل نتائج الفهرس إلى صيغة النتائج", async () => {
    dm.chunks = [chunk("c1", "نص القطعة الأولى", "doc.txt")];
    vec.results = [{ chunkId: "c1", score: 0.9 }];

    const result = await tool().execute({ query: "سؤال", search_mode: "semantic", scope: "all" });

    expect(emb.embed).toHaveBeenCalledWith("سؤال");
    expect(vec.calls).toHaveLength(1);
    expect(vec.calls[0].k).toBe(20);
    expect(result).toContain("[BEGIN DOCUMENT: doc.txt, result 1]");
    expect(result).toContain("نص القطعة الأولى");
  });

  it("يحمّل النموذج عند عدم تحميله مسبقًا", async () => {
    emb.isLoaded = false;
    dm.chunks = [chunk("c1", "نص")];
    vec.results = [{ chunkId: "c1", score: 0.5 }];

    await tool().execute({ query: "س", search_mode: "semantic", scope: "all" });

    expect(emb.loadCalls).toBe(1);
  });

  it("يعيد رسالة ودّية عند فشل تحميل النموذج", async () => {
    emb.isLoaded = false;
    emb.loadError = new Error("no network");
    dm.chunks = [chunk("c1", "نص")];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await tool().execute({ query: "س", search_mode: "semantic", scope: "all" });

    expect(result).toBe(
      "The local embedding model could not be loaded. Check your internet connection and try again.",
    );
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("يعيد unknown لمصدر قطعة غير موجودة", async () => {
    dm.chunks = [chunk("c1", "نص")];
    vec.results = [{ chunkId: "ghost", score: 0.3 }];

    const result = await tool().execute({ query: "س", search_mode: "semantic", scope: "all" });

    expect(result).toContain("[BEGIN DOCUMENT: unknown, result 1]");
    expect(result).toContain("\n\n[END DOCUMENT]");
  });
});

describe("execute — النمط المختلط", () => {
  it("يدمج النتائج الدلالية والكلمات المفتاحية", async () => {
    dm.chunks = [chunk("c1", "الشورى مبدأ", "a.txt"), chunk("c2", "نص آخر", "b.txt")];
    vec.results = [{ chunkId: "c2", score: 0.9 }];

    const result = await tool().execute({ query: "الشورى", search_mode: "hybrid", scope: "all" });

    expect(emb.embed).toHaveBeenCalledTimes(1);
    expect(result).toContain("a.txt");
    expect(result).toContain("b.txt");
  });

  it("يحترم searchResultCount في النمط المختلط", async () => {
    dm.chunks = [
      chunk("c1", "الشورى أولًا", "a.txt"),
      chunk("c2", "الشورى ثانيًا", "b.txt"),
      chunk("c3", "الشورى ثالثًا", "c.txt"),
    ];

    const result = await tool({ searchResultCount: 1 }).execute({
      query: "الشورى",
      search_mode: "hybrid",
      scope: "all",
    });

    expect(result).toContain("result 1");
    expect(result).not.toContain("result 2");
  });

  it("يعيد رسالة ودّية عند فشل تحميل النموذج", async () => {
    emb.isLoaded = false;
    emb.loadError = new Error("no network");
    dm.chunks = [chunk("c1", "نص")];
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await tool().execute({ query: "س", search_mode: "hybrid", scope: "all" });

    expect(result).toContain("could not be loaded");
  });
});

describe("execute — التخزين المؤقت", () => {
  it("يعيد النتيجة المخزّنة دون إعادة البحث", async () => {
    dm.chunks = [chunk("c1", "الشورى مبدأ", "a.txt")];
    const searchTool = tool();

    const first = await searchTool.execute({ query: "الشورى", search_mode: "keyword", scope: "all" });
    dm.chunks = [];
    const second = await searchTool.execute({ query: "الشورى", search_mode: "keyword", scope: "all" });

    expect(second).toBe(first);
    expect(dm.calls).toBe(1);
  });

  it("يميّز المفاتيح حسب النمط والنطاق", async () => {
    dm.chunks = [chunk("c1", "الشورى مبدأ", "a.txt")];
    const searchTool = tool();

    await searchTool.execute({ query: "الشورى", search_mode: "keyword", scope: "all" });
    await searchTool.execute({ query: "الشورى", search_mode: "keyword", scope: "uploads" });

    expect(dm.calls).toBe(2);
  });

  it("يعيد رسالة عدم وجود نتائج من نتيجة فارغة مخزّنة", async () => {
    searchCache.set(
      { query: "س", mode: "keyword", scope: "all" },
      [],
    );

    const result = await tool().execute({ query: "س", search_mode: "keyword", scope: "all" });

    expect(result).toBe("No relevant documents found.");
    expect(dm.calls).toBe(0);
  });

  it("clearSearchCache يجبر إعادة البحث", async () => {
    dm.chunks = [chunk("c1", "الشورى مبدأ", "a.txt")];
    const searchTool = tool();

    await searchTool.execute({ query: "الشورى", search_mode: "keyword", scope: "all" });
    clearSearchCache();
    dm.chunks = [];
    const after = await searchTool.execute({ query: "الشورى", search_mode: "keyword", scope: "all" });

    expect(dm.calls).toBe(2);
    expect(after).toBe("No documents are indexed yet. The user hasn't uploaded any files.");
  });
});
