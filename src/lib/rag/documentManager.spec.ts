import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/db";
import type { RagChunk, RagDocument, RagSettings } from "@/types";
import { DEFAULT_RAG_SETTINGS } from "@/types";

const emb = vi.hoisted(() => ({
  constructorArgs: [] as Array<[string, number]>,
  initialize: vi.fn(async () => {}),
  embedBatch: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2])),
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
    {
      id: "multilingual-e5-base",
      modelId: "multilingual-e5-base",
      label: "Multilingual E5 Base",
      dimensions: 768,
      downloadedAt: 0,
      sizeBytes: 2,
    },
  ],
  OnnxEmbedder: class {
    constructor(modelId: string, dimensions: number) {
      emb.constructorArgs.push([modelId, dimensions]);
    }
    initialize() {
      return emb.initialize();
    }
    embedBatch(texts: string[]) {
      return emb.embedBatch(texts);
    }
  },
}));

const vec = vi.hoisted(() => ({
  addVectors: vi.fn<(items: Array<{ chunkId: string; vector: number[] }>) => Promise<void>>(
    async () => {},
  ),
  clearAllIndexes: vi.fn(),
  modelIds: [] as string[],
}));

vi.mock("./vectorIndex", () => ({
  getVectorIndex: (modelId: string) => {
    vec.modelIds.push(modelId);
    return { addVectors: vec.addVectors };
  },
  clearAllIndexes: vec.clearAllIndexes,
}));

import {
  cleanupTempDocuments,
  cleanupTempDocumentsForSession,
  deleteDocument,
  getAllChunks,
  getChunks,
  getDocuments,
  indexDocument,
  reindexAllDocuments,
} from "./documentManager";

const settings = (over: Partial<RagSettings> = {}): RagSettings => ({
  ...DEFAULT_RAG_SETTINGS,
  chunkSize: 500,
  chunkOverlap: 0,
  ...over,
});

const file = (name: string, content = "نص الملف للاختبار") => new File([content], name);

const storedDoc = (id: string, over: Partial<RagDocument> = {}): RagDocument => ({
  id,
  source: "upload",
  persistence: "persistent",
  fileName: id + ".txt",
  fileType: "txt",
  fileSize: 10,
  status: "indexed",
  uploadedAt: 1,
  chunkCount: 1,
  embeddingModelId: "multilingual-e5-small",
  ...over,
});

const storedChunk = (id: string, documentId: string, chunkIndex: number): RagChunk => ({
  id,
  documentId,
  chunkIndex,
  text: "نص",
  embedding: [0.1],
  metadata: { source: "a.txt", timestamp: 1 },
});

beforeEach(async () => {
  await db.rag_documents.clear();
  await db.rag_chunks.clear();
  emb.constructorArgs = [];
  emb.initialize.mockClear();
  emb.embedBatch.mockReset();
  emb.embedBatch.mockImplementation(async (texts: string[]) => texts.map(() => [0.1, 0.2]));
  vec.addVectors.mockClear();
  vec.clearAllIndexes.mockClear();
  vec.modelIds = [];
});

describe("indexDocument", () => {
  it("يفهرس ملفًا نصيًا: يستخرج ويقسّم ويضمّن ويخزّن ويحدّث الحالة", async () => {
    const result = await indexDocument(file("notes.txt"), {
      persistence: "persistent",
      settings: settings(),
    });

    expect(result.status).toBe("indexed");
    expect(result.source).toBe("upload");
    expect(result.fileName).toBe("notes.txt");
    expect(result.fileType).toBe("txt");
    expect(result.chunkCount).toBeGreaterThan(0);

    const stored = await db.rag_documents.get(result.id);
    expect(stored?.status).toBe("indexed");
    expect(stored?.chunkCount).toBe(result.chunkCount);

    const chunks = await db.rag_chunks.where("documentId").equals(result.id).toArray();
    expect(chunks).toHaveLength(result.chunkCount);
    expect(chunks[0].text).toContain("نص الملف");
    expect(chunks[0].metadata.source).toBe("notes.txt");
    expect(chunks[0].chunkIndex).toBe(0);

    expect(emb.initialize).toHaveBeenCalledTimes(1);
    expect(vec.addVectors).toHaveBeenCalledTimes(1);
    expect(vec.addVectors.mock.calls[0][0]).toHaveLength(result.chunkCount);
    expect(vec.modelIds).toEqual(["multilingual-e5-small"]);
  });

  it("يعلّم المستند كمصدر خارجي عند تمرير معرّف مجلد", async () => {
    const result = await indexDocument(file("external.md"), {
      persistence: "persistent",
      folderId: "folder-1",
      settings: settings(),
    });

    expect(result.source).toBe("external");
    expect(result.folderId).toBe("folder-1");
  });

  it("يسجّل جلسة المستند والحفظ المؤقت عند تمريرهما", async () => {
    const result = await indexDocument(file("temp.txt"), {
      persistence: "temp",
      sessionId: "s1",
      settings: settings(),
    });

    expect(result.persistence).toBe("temp");
    expect(result.sessionId).toBe("s1");
  });

  it("يعود إلى النموذج الأول عندما يكون معرّف النموذج غير معروف", async () => {
    await indexDocument(file("a.txt"), {
      persistence: "persistent",
      settings: settings({ embeddingModelId: "unknown-model" }),
    });

    expect(emb.constructorArgs).toEqual([["multilingual-e5-small", 384]]);
    expect(vec.modelIds).toEqual(["unknown-model"]);
  });

  it("يستخدم النموذج المطلوب عندما يكون معروفًا", async () => {
    await indexDocument(file("a.txt"), {
      persistence: "persistent",
      settings: settings({ embeddingModelId: "multilingual-e5-base" }),
    });

    expect(emb.constructorArgs).toEqual([["multilingual-e5-base", 768]]);
  });

  it("يسجّل حالة الخطأ ويرمي عندما يكون نوع الملف غير مدعوم", async () => {
    await expect(
      indexDocument(file("report.docx"), { persistence: "persistent", settings: settings() }),
    ).rejects.toThrow("Unsupported file type: unknown");

    const docs = await db.rag_documents.toArray();
    expect(docs).toHaveLength(1);
    expect(docs[0].status).toBe("error");
    expect(docs[0].error).toBe("Unsupported file type: unknown");
    expect(vec.addVectors).not.toHaveBeenCalled();
  });

  it("يسجّل حالة الخطأ عندما يفشل التضمين", async () => {
    emb.embedBatch.mockRejectedValue(new Error("inference failed"));

    await expect(
      indexDocument(file("a.txt"), { persistence: "persistent", settings: settings() }),
    ).rejects.toThrow("inference failed");

    const docs = await db.rag_documents.toArray();
    expect(docs[0].status).toBe("error");
    expect(docs[0].error).toBe("inference failed");
  });

  it("يحوّل الأخطاء غير الكائنية إلى نص عند التسجيل", async () => {
    emb.embedBatch.mockRejectedValue("boom");

    await expect(
      indexDocument(file("a.txt"), { persistence: "persistent", settings: settings() }),
    ).rejects.toBe("boom");

    const docs = await db.rag_documents.toArray();
    expect(docs[0].error).toBe("boom");
  });

  it("ينشئ مستندًا بلا قطع عندما يكون النص فارغًا", async () => {
    const result = await indexDocument(file("empty.txt", ""), {
      persistence: "persistent",
      settings: settings(),
    });

    expect(result.chunkCount).toBe(0);
    expect(await db.rag_chunks.count()).toBe(0);
    expect(vec.addVectors).toHaveBeenCalledWith([]);
  });
});

describe("deleteDocument", () => {
  it("يحذف المستند وكل قطعه", async () => {
    await db.rag_documents.put(storedDoc("d1"));
    await db.rag_documents.put(storedDoc("d2"));
    await db.rag_chunks.bulkPut([storedChunk("c1", "d1", 0), storedChunk("c2", "d2", 0)]);

    await deleteDocument("d1");

    expect(await db.rag_documents.get("d1")).toBeUndefined();
    expect(await db.rag_documents.get("d2")).toBeDefined();
    expect(await db.rag_chunks.where("documentId").equals("d1").count()).toBe(0);
    expect(await db.rag_chunks.where("documentId").equals("d2").count()).toBe(1);
  });
});

describe("getDocuments", () => {
  beforeEach(async () => {
    await db.rag_documents.bulkPut([
      storedDoc("u1", { source: "upload", persistence: "persistent" }),
      storedDoc("u2", { source: "upload", persistence: "temp" }),
      storedDoc("e1", { source: "external", persistence: "persistent" }),
      storedDoc("s1", { source: "session", persistence: "persistent" }),
    ]);
  });

  it("يعيد كل المستندات بلا مرشّح", async () => {
    expect(await getDocuments()).toHaveLength(4);
  });

  it("يرشّح حسب المصدر", async () => {
    const uploads = await getDocuments({ source: "upload" });
    expect(uploads.map((d) => d.id).sort()).toEqual(["u1", "u2"]);
  });

  it("يرشّح حسب الحفظ", async () => {
    const temp = await getDocuments({ persistence: "temp" });
    expect(temp.map((d) => d.id)).toEqual(["u2"]);
  });

  it("يجمع المرشّحين معًا", async () => {
    const result = await getDocuments({ source: "upload", persistence: "persistent" });
    expect(result.map((d) => d.id)).toEqual(["u1"]);
  });

  it("يعيد مصفوفة فارغة عندما لا يوجد تطابق", async () => {
    expect(await getDocuments({ source: "session", persistence: "temp" })).toEqual([]);
  });
});

describe("getChunks / getAllChunks", () => {
  it("يعيد قطع المستند مرتّبة حسب chunkIndex", async () => {
    await db.rag_chunks.bulkPut([
      storedChunk("c2", "d1", 2),
      storedChunk("c0", "d1", 0),
      storedChunk("c1", "d1", 1),
      storedChunk("other", "d2", 0),
    ]);

    const chunks = await getChunks("d1");

    expect(chunks.map((c) => c.id)).toEqual(["c0", "c1", "c2"]);
  });

  it("يعيد كل القطع عبر المستندات", async () => {
    await db.rag_chunks.bulkPut([storedChunk("c1", "d1", 0), storedChunk("c2", "d2", 0)]);

    expect(await getAllChunks()).toHaveLength(2);
  });

  it("يعيد مصفوفة فارغة عندما لا توجد قطع", async () => {
    expect(await getChunks("ghost")).toEqual([]);
    expect(await getAllChunks()).toEqual([]);
  });
});

// كان هذان الاختباران يثبّتان خطأً إنتاجيًا: "persistence" لم يكن مفهرسًا في
// مخطط rag_documents فترمي دالتا التنظيف SchemaError. أُصلح في db.ts (v5).
describe("cleanupTempDocuments", () => {
  it("يحذف المؤقتات وقطعها ويُبقي المستندات الدائمة", async () => {
    await db.rag_documents.bulkPut([
      storedDoc("t1", { persistence: "temp" }),
      storedDoc("t2", { persistence: "temp" }),
      storedDoc("p1", { persistence: "persistent" }),
    ]);
    await db.rag_chunks.bulkPut([storedChunk("c1", "t1", 0), storedChunk("c2", "p1", 0)]);

    expect(await cleanupTempDocuments()).toBe(2);

    expect((await db.rag_documents.toArray()).map((d) => d.id)).toEqual(["p1"]);
    expect(await db.rag_chunks.count()).toBe(1);
  });

  it("cleanupTempDocumentsForSession يحذف جلسة واحدة وحدها", async () => {
    await db.rag_documents.bulkPut([
      storedDoc("t1", { persistence: "temp", sessionId: "s1" }),
      storedDoc("t2", { persistence: "temp", sessionId: "s2" }),
    ]);

    expect(await cleanupTempDocumentsForSession("s1")).toBe(1);

    expect((await db.rag_documents.toArray()).map((d) => d.id)).toEqual(["t2"]);
  });
});

describe("reindexAllDocuments", () => {
  it("يمسح كل القطع ويصفّر العدّاد ويضع المستندات في pending", async () => {
    await db.rag_documents.bulkPut([
      storedDoc("d1", { chunkCount: 4 }),
      storedDoc("d2", { status: "error" }),
    ]);
    await db.rag_chunks.bulkPut([storedChunk("c1", "d1", 0), storedChunk("c2", "d2", 0)]);

    await reindexAllDocuments(settings({ embeddingModelId: "multilingual-e5-base" }));

    expect(await db.rag_chunks.count()).toBe(0);
    expect(vec.clearAllIndexes).toHaveBeenCalledTimes(1);

    const docs = await db.rag_documents.toArray();
    for (const d of docs) {
      expect(d.status).toBe("pending");
      expect(d.embeddingModelId).toBe("multilingual-e5-base");
    }
    expect(docs.find((d) => d.id === "d1")?.chunkCount).toBe(4);
  });

  it("لا يفشل عند عدم وجود مستندات", async () => {
    await expect(reindexAllDocuments(settings())).resolves.toBeUndefined();
    expect(vec.clearAllIndexes).toHaveBeenCalledTimes(1);
  });
});
