import { describe, expect, it, vi } from "vitest";
import type { RagChunk, RagSettings } from "@/types";
import { DEFAULT_RAG_SETTINGS } from "@/types";

const dm = vi.hoisted(() => ({ chunks: [] as RagChunk[] }));

vi.mock("./documentManager", () => ({
  getAllChunks: async () => dm.chunks,
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
    embed() {
      return Promise.resolve([0.1, 0.2]);
    }
  },
  isModelLoaded: () => true,
  loadEmbeddingModel: async () => ({}),
}));

vi.mock("./vectorIndex", () => ({
  getVectorIndex: () => ({
    version: null,
    size: 0,
    search: async () => [],
    buildFromChunks: async () => {},
  }),
}));

import { currentEmbeddingVersion, embeddingVersionOf, isChunkStale } from "./embeddingVersion";
import { clearSearchCache, createSearchDocumentsTool } from "./tool";

const settings = (over: Partial<RagSettings> = {}): RagSettings => ({
  ...DEFAULT_RAG_SETTINGS,
  ...over,
});

function chunk(id: string, text: string, embeddingVersion?: string): RagChunk {
  return {
    id,
    documentId: "d1",
    chunkIndex: 0,
    text,
    embedding: [0.1, 0.2],
    metadata: { source: "a.txt", timestamp: 1 },
    embeddingVersion,
  };
}

const activeVersion = () => currentEmbeddingVersion("multilingual-e5-small");

describe("هوية التضمين (T1.2)", () => {
  it("embeddingVersionOf يجمع المعرّف والمُرمِّز والأبعاد بفاصل واحد", () => {
    expect(embeddingVersionOf({ modelId: "m", tokenizerVersion: "r@main", dimensions: 384 })).toBe(
      "m:r@main:384",
    );
  });

  it("currentEmbeddingVersion يقرأ الكتالوج ولا يخترع هوية لنموذج غير معروف", () => {
    expect(activeVersion()).toBe(
      "multilingual-e5-small:Xenova/multilingual-e5-small@main:384",
    );
    expect(currentEmbeddingVersion("ghost-model")).toBeNull();
  });

  it("isChunkStale: بلا ختم قديمة، وبفضاء آخر قديمة، وبالختم الحالي حديثة", () => {
    const active = activeVersion();
    expect(isChunkStale(chunk("a", "t"), active)).toBe(true);
    expect(isChunkStale(chunk("b", "t", "Xenova/multilingual-e5-base@main:768"), active)).toBe(true);
    expect(isChunkStale(chunk("c", "t", active as string), active)).toBe(false);
    expect(isChunkStale(chunk("d", "t", active as string), null)).toBe(true);
  });
});

describe("البحث لا يخلط فضاءَي متجهات (T1.2)", () => {
  it("لا يعيد قطعًا من فضاء سابق أو بلا ختم، ويعيد الحديثة وحدها", async () => {
    const active = activeVersion() as string;
    dm.chunks = [
      chunk("current", "مرحبا CURRENT", active),
      chunk("foreign", "مرحبا FOREIGN", "Xenova/multilingual-e5-base@main:768"),
      chunk("unstamped", "مرحبا UNSTAMPED"),
    ];
    clearSearchCache();
    const tool = createSearchDocumentsTool({ settings: settings() });
    const out = await tool.execute({
      query: "مرحبا",
      search_mode: "keyword",
      scope: "all",
    });
    expect(out).toContain("CURRENT");
    expect(out).not.toContain("FOREIGN");
    expect(out).not.toContain("UNSTAMPED");
  });

  it("حين تكون كل القطع قديمة لا تُسرَّب نصوصها ولا تُعاد نتيجة صامتة بلا سبب", async () => {
    dm.chunks = [chunk("unstamped", "مرحبا UNSTAMPED")];
    clearSearchCache();
    const tool = createSearchDocumentsTool({ settings: settings() });
    const out = await tool.execute({
      query: "مرحبا",
      search_mode: "keyword",
      scope: "all",
    });
    expect(out).not.toContain("UNSTAMPED");
    expect(out).toBe("No relevant documents found.");
  });
});
