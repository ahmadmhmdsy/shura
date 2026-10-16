/**
 * ترشيح النطاق على الجداول الحقيقية (NM-05).
 *
 * `tool.spec.ts` يختبر التركيب على واجهة موك، وهذا الملف يختبر الوصل نفسه على
 * Dexie حقيقي: مستند مرفوع وآخر لجلسة وثالث خارجي، ثم `scope` ينتقي مصدره وحده.
 * المضمّن والفهرس موكان لأن التضمين الحقيقي يحتاج تنزيل نموذج.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/db";
import type { RagChunk, RagDocument, RagSettings } from "@/types";
import { DEFAULT_RAG_SETTINGS } from "@/types";

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
    async embed() {
      return [0.1, 0.2];
    }
  },
  isModelLoaded: () => true,
  loadEmbeddingModel: async () => ({}),
}));

vi.mock("./vectorIndex", () => ({
  getVectorIndex: () => ({ size: 1, search: async () => [] }),
}));

import { currentEmbeddingVersion } from "./embeddingVersion";
import { clearSearchCache, createSearchDocumentsTool } from "./tool";

const MODEL_ID = "multilingual-e5-small";
const settings: RagSettings = { ...DEFAULT_RAG_SETTINGS, searchResultCount: 10 };

const document = (id: string, source: RagDocument["source"]): RagDocument => ({
  id,
  source,
  persistence: "persistent",
  fileName: id + ".txt",
  fileType: "text/plain",
  fileSize: 10,
  status: "indexed",
  uploadedAt: 1,
  chunkCount: 1,
  embeddingModelId: MODEL_ID,
});

const chunk = (id: string, documentId: string, text: string): RagChunk => ({
  id,
  documentId,
  chunkIndex: 0,
  text,
  embedding: [0.1, 0.2],
  embeddingVersion: currentEmbeddingVersion(MODEL_ID) ?? undefined,
  metadata: { source: documentId + ".txt", timestamp: 1 },
});

const tool = () => createSearchDocumentsTool({ settings });

beforeEach(async () => {
  clearSearchCache();
  await db.rag_documents.clear();
  await db.rag_chunks.clear();
});

describe("scope على الجداول الحقيقية", () => {
  beforeEach(async () => {
    await db.rag_documents.bulkAdd([
      document("doc-up", "upload"),
      document("doc-sess", "session"),
      document("doc-ext", "external"),
    ]);
    await db.rag_chunks.bulkAdd([
      chunk("c-up", "doc-up", "الشورى نص المرفوع"),
      chunk("c-sess", "doc-sess", "الشورى نص الجلسة"),
      chunk("c-ext", "doc-ext", "الشورى نص الخارجي"),
    ]);
  });

  it("scope=uploads يعيد قطع المستند المرفوع وحده", async () => {
    const result = await tool().execute({ query: "الشورى", search_mode: "keyword", scope: "uploads" });

    expect(result).toContain("نص المرفوع");
    expect(result).not.toContain("نص الجلسة");
    expect(result).not.toContain("نص الخارجي");
  });

  it("scope=sessions يعيد قطع الجلسة وحدها", async () => {
    const result = await tool().execute({ query: "الشورى", search_mode: "keyword", scope: "sessions" });

    expect(result).toContain("نص الجلسة");
    expect(result).not.toContain("نص المرفوع");
    expect(result).not.toContain("نص الخارجي");
  });

  it("scope=all يعيد المصادر الثلاثة", async () => {
    const result = await tool().execute({ query: "الشورى", search_mode: "keyword", scope: "all" });

    expect(result).toContain("نص المرفوع");
    expect(result).toContain("نص الجلسة");
    expect(result).toContain("نص الخارجي");
  });

  it("لا يعيد قطعًا لمستندها صفّ محذوف في نطاق محدّد", async () => {
    await db.rag_documents.delete("doc-up");

    const result = await tool().execute({ query: "الشورى", search_mode: "keyword", scope: "uploads" });

    expect(result).toBe("No relevant documents found.");
  });
});
