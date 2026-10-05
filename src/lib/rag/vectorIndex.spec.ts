import { beforeEach, describe, expect, it, vi } from "vitest";

// hnswlib-wasm is mocked globally in src/test/setup.ts; this file-level factory
// replaces it with an instrumented double so the wrapper's argument passing and
// label → chunkId mapping can be asserted.
const hnsw = vi.hoisted(() => ({
  constructorArgs: [] as unknown[][],
  initArgs: [] as unknown[][],
  added: [] as Array<{ vector: number[]; label: number; replace: boolean }>,
  searchResult: { neighbors: [] as number[], distances: [] as number[] },
  searchArgs: [] as unknown[][],
  loadCalls: 0,
}));

vi.mock("hnswlib-wasm", () => ({
  loadHnswlib: async () => {
    hnsw.loadCalls++;
    return {
      HierarchicalNSW: class {
        constructor(...args: unknown[]) {
          hnsw.constructorArgs.push(args);
        }
        initIndex(...args: unknown[]) {
          hnsw.initArgs.push(args);
        }
        addPoint(vector: number[], label: number, replace: boolean) {
          hnsw.added.push({ vector, label, replace });
        }
        searchKnn(...args: unknown[]) {
          hnsw.searchArgs.push(args);
          return hnsw.searchResult;
        }
      },
    };
  },
}));

import { VectorIndex, clearAllIndexes, getVectorIndex } from "./vectorIndex";
import type { RagChunk } from "@/types";

const chunk = (id: string): RagChunk => ({
  id,
  documentId: "doc1",
  chunkIndex: 0,
  text: "نص",
  embedding: [0.1, 0.2],
  metadata: { source: "a.txt", timestamp: 1 },
});

beforeEach(() => {
  hnsw.constructorArgs = [];
  hnsw.initArgs = [];
  hnsw.added = [];
  hnsw.searchArgs = [];
  hnsw.searchResult = { neighbors: [], distances: [] };
  hnsw.loadCalls = 0;
  clearAllIndexes();
});

describe("VectorIndex", () => {
  it("يُنشئ فهرس cosine بالأبعاد المطلوبة ويهيّئه بالمعاملات المتوقعة", async () => {
    const index = new VectorIndex(384);

    await index.initialize();

    expect(hnsw.constructorArgs).toEqual([["cosine", 384, ""]]);
    expect(hnsw.initArgs).toEqual([[1000, 16, 200, 100]]);
    expect(index.size).toBe(0);
  });

  it("لا يعيد التهيئة عند الاستدعاء المتكرر", async () => {
    const index = new VectorIndex(384);

    await index.initialize();
    await index.initialize();

    expect(hnsw.constructorArgs).toHaveLength(1);
    expect(hnsw.loadCalls).toBe(1);
  });

  it("يهيّئ تلقائيًا عند إضافة متجه دون تهيئة مسبقة", async () => {
    const index = new VectorIndex(3);

    await index.addVector("chunk-a", [1, 2, 3]);

    expect(hnsw.constructorArgs).toHaveLength(1);
    expect(hnsw.added).toEqual([{ vector: [1, 2, 3], label: 0, replace: false }]);
    expect(index.size).toBe(1);
  });

  it("يزيد التسمية تسلسليًا مع كل متجه مضاف", async () => {
    const index = new VectorIndex(3);

    await index.addVector("chunk-a", [1, 0, 0]);
    await index.addVector("chunk-b", [0, 1, 0]);

    expect(hnsw.added.map((a) => a.label)).toEqual([0, 1]);
    expect(index.size).toBe(2);
  });

  it("يضيف دفعة متجهات كاملة", async () => {
    const index = new VectorIndex(2);

    await index.addVectors([
      { chunkId: "a", vector: [1, 1] },
      { chunkId: "b", vector: [2, 2] },
      { chunkId: "c", vector: [3, 3] },
    ]);

    expect(hnsw.added.map((a) => a.label)).toEqual([0, 1, 2]);
    expect(index.size).toBe(3);
    expect(hnsw.added[2].vector).toEqual([3, 3]);
  });

  it("لا يضيف شيئًا عند تمرير دفعة فارغة", async () => {
    const index = new VectorIndex(2);

    await index.addVectors([]);

    expect(hnsw.added).toEqual([]);
    expect(index.size).toBe(0);
    // التهيئة تحدث قبل الحلقة حتى مع دفعة فارغة
    expect(hnsw.constructorArgs).toHaveLength(1);
  });

  it("يحوّل المسافة إلى تشابه ويربط التسمية بمعرّف القطعة", async () => {
    const index = new VectorIndex(2);
    await index.addVector("chunk-a", [1, 0]);
    await index.addVector("chunk-b", [0, 1]);

    hnsw.searchResult = { neighbors: [1, 0], distances: [0.25, 0.5] };
    const results = await index.search([1, 1], 2);

    expect(results).toEqual([
      { chunkId: "chunk-b", score: 0.75 },
      { chunkId: "chunk-a", score: 0.5 },
    ]);
    expect(hnsw.searchArgs).toHaveLength(1);
    expect(hnsw.searchArgs[0][0]).toEqual([1, 1]);
    expect(hnsw.searchArgs[0][1]).toBe(2);
    expect(hnsw.searchArgs[0][2]).toBeTypeOf("function");
  });

  it("يعيد مصفوفة فارغة عندما لا يعيد الفهرس أي جار", async () => {
    const index = new VectorIndex(2);
    await index.initialize();

    expect(await index.search([1, 1])).toEqual([]);
  });

  it("يبني الفهرس من القطع المخزَّنة ويعيد ضبط التسميات", async () => {
    const index = new VectorIndex(2);
    await index.addVector("stale", [9, 9]);

    await index.buildFromChunks([chunk("c1"), chunk("c2")]);

    expect(index.size).toBe(2);
    expect(hnsw.initArgs.at(-1)).toEqual([1000, 16, 200, 100]);
    expect(hnsw.added.at(-2)).toEqual({ vector: [0.1, 0.2], label: 0, replace: false });
    expect(hnsw.added.at(-1)).toEqual({ vector: [0.1, 0.2], label: 1, replace: false });
  });

  it("يوسّع سعة الفهرس عندما يتجاوز عدد القطع 500", async () => {
    const index = new VectorIndex(2);
    const chunks = Array.from({ length: 600 }, (_, i) => chunk("c" + i));

    await index.buildFromChunks(chunks);

    expect(hnsw.initArgs.at(-1)).toEqual([1200, 16, 200, 100]);
    expect(index.size).toBe(600);
  });

  it("يعيد بناء الفهرس فارغًا عند تمرير قائمة قطع فارغة", async () => {
    const index = new VectorIndex(2);
    await index.addVector("stale", [9, 9]);

    await index.buildFromChunks([]);

    expect(index.size).toBe(0);
    expect(hnsw.initArgs.at(-1)).toEqual([1000, 16, 200, 100]);
  });

  it("يمسح الفهرس ويعيد التهيئة عند أول عملية لاحقة", async () => {
    const index = new VectorIndex(2);
    await index.addVector("a", [1, 1]);

    index.clear();
    expect(index.size).toBe(0);

    await index.addVector("b", [2, 2]);

    expect(hnsw.constructorArgs).toHaveLength(2);
    expect(index.size).toBe(1);
    expect(hnsw.added.at(-1)?.label).toBe(0);
  });
});

describe("getVectorIndex / clearAllIndexes", () => {
  it("يعيد النسخة نفسها للنموذج نفسه", () => {
    const first = getVectorIndex("model-a", 384);
    const second = getVectorIndex("model-a", 384);

    expect(second).toBe(first);
  });

  it("يعيد نسخة مستقلة لكل نموذج", () => {
    const a = getVectorIndex("model-a", 384);
    const b = getVectorIndex("model-b", 768);

    expect(b).not.toBe(a);
    expect(getVectorIndex("model-b", 1)).toBe(b);
  });

  it("يمسح كل الفهارس ويجعل الاستدعاء التالي ينشئ نسخة جديدة", async () => {
    const first = getVectorIndex("model-a", 2);
    await first.addVector("a", [1, 1]);

    clearAllIndexes();

    const second = getVectorIndex("model-a", 2);
    expect(second).not.toBe(first);
    expect(second.size).toBe(0);
  });

  it("لا يفشل عند مسح فهارس غير موجودة", () => {
    expect(() => clearAllIndexes()).not.toThrow();
  });
});
