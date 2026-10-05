import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/db";
import type { RagChunk, RagDocument, RagSettings } from "@/types";
import { DEFAULT_RAG_SETTINGS } from "@/types";

const vec = vi.hoisted(() => ({ clearAllIndexes: vi.fn() }));

vi.mock("./vectorIndex", () => ({
  clearAllIndexes: vec.clearAllIndexes,
}));

import {
  getModelInfo,
  getReindexDocumentCount,
  needsReindex,
  reindexAllDocuments,
  validateModelSwitch,
} from "./reindexManager";

const doc = (id: string, over: Partial<RagDocument> = {}): RagDocument => ({
  id,
  source: "upload",
  persistence: "persistent",
  fileName: id + ".txt",
  fileType: "txt",
  fileSize: 10,
  status: "indexed",
  uploadedAt: 1,
  chunkCount: 3,
  embeddingModelId: "multilingual-e5-small",
  ...over,
});

const chunk = (id: string, documentId: string): RagChunk => ({
  id,
  documentId,
  chunkIndex: 0,
  text: "نص",
  embedding: [0.1],
  metadata: { source: "a.txt", timestamp: 1 },
});

const settings = (over: Partial<RagSettings> = {}): RagSettings => ({
  ...DEFAULT_RAG_SETTINGS,
  ...over,
});

beforeEach(async () => {
  await db.rag_documents.clear();
  await db.rag_chunks.clear();
  vec.clearAllIndexes.mockReset();
});

describe("reindexAllDocuments", () => {
  it("يحذف القطع ويمسح الفهرس ويضع كل المستندات في حالة pending", async () => {
    await db.rag_documents.bulkPut([doc("d1"), doc("d2", { status: "error" })]);
    await db.rag_chunks.bulkPut([chunk("c1", "d1"), chunk("c2", "d2")]);

    await reindexAllDocuments(settings({ embeddingModelId: "multilingual-e5-base" }));

    expect(vec.clearAllIndexes).toHaveBeenCalledTimes(1);
    expect(await db.rag_chunks.count()).toBe(0);

    const docs = await db.rag_documents.toArray();
    expect(docs).toHaveLength(2);
    for (const d of docs) {
      expect(d.status).toBe("pending");
      expect(d.embeddingModelId).toBe("multilingual-e5-base");
      expect(d.chunkCount).toBe(0);
    }
  });

  it("لا يفشل عند عدم وجود مستندات", async () => {
    await expect(reindexAllDocuments(settings())).resolves.toBeUndefined();
    expect(vec.clearAllIndexes).toHaveBeenCalledTimes(1);
  });
});

describe("needsReindex", () => {
  it("يقارن معرّفي النموذج", () => {
    expect(needsReindex("a", "a")).toBe(false);
    expect(needsReindex("a", "b")).toBe(true);
  });
});

describe("getReindexDocumentCount", () => {
  it("يعدّ المستندات في حالة pending فقط", async () => {
    await db.rag_documents.bulkPut([
      doc("d1", { status: "pending" }),
      doc("d2", { status: "pending" }),
      doc("d3", { status: "indexed" }),
    ]);

    expect(await getReindexDocumentCount()).toBe(2);
  });

  it("يعيد صفرًا عندما لا توجد مستندات", async () => {
    expect(await getReindexDocumentCount()).toBe(0);
  });
});

describe("validateModelSwitch", () => {
  it("يعتبر التبديل آمنًا عند نفس النموذج", () => {
    expect(validateModelSwitch("m", "m")).toEqual({ safe: true });
  });

  it("يحذّر عند تبديل النموذج", () => {
    const result = validateModelSwitch("m1", "m2");

    expect(result.safe).toBe(false);
    expect(result.warning).toContain("إعادة فهرسة");
  });
});

describe("getModelInfo", () => {
  it("يعيد معلومات النموذج المعروف", () => {
    const model = getModelInfo("multilingual-e5-small");

    expect(model?.dimensions).toBe(384);
    expect(model?.label).toContain("Multilingual");
  });

  it("يعيد null للنموذج المجهول", () => {
    expect(getModelInfo("nope")).toBeNull();
  });
});
