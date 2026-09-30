import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/db";
import type { RagChunk, RagDocument, RagFolder } from "@/types";
import { importRagData, validateRagImportData } from "./ragImporter";

const document: RagDocument = {
  id: "doc-1",
  source: "upload",
  persistence: "persistent",
  fileName: "تقرير-المنتج.pdf",
  fileType: "application/pdf",
  fileSize: 4096,
  status: "indexed",
  uploadedAt: Date.parse("2026-09-20T08:00:00Z"),
  chunkCount: 2,
  embeddingModelId: "embeddinggemma-300m",
};

const chunks: RagChunk[] = [
  {
    id: "chunk-1",
    documentId: "doc-1",
    chunkIndex: 0,
    text: "نص القطعة الأولى من التقرير",
    embedding: [0.1, 0.2, 0.3],
    metadata: { source: "تقرير-المنتج.pdf", timestamp: Date.parse("2026-09-20T08:00:00Z") },
  },
  {
    id: "chunk-2",
    documentId: "doc-1",
    chunkIndex: 1,
    text: "نص القطعة الثانية من التقرير",
    embedding: [0.4, 0.5, 0.6],
    metadata: { pageNumber: 2, source: "تقرير-المنتج.pdf", timestamp: Date.parse("2026-09-20T08:00:00Z") },
  },
];

const folder: RagFolder = {
  id: "folder-1",
  path: "/docs",
  label: "مستندات العمل",
  autoReindex: true,
  lastIndexedAt: Date.parse("2026-09-20T09:30:00Z"),
  status: "active",
};

beforeEach(async () => {
  await db.rag_documents.clear();
  await db.rag_chunks.clear();
  await db.rag_folders.clear();
});

describe("validateRagImportData", () => {
  it("يُرجع true لبيانات صالحة", () => {
    const data = { documents: [document], chunks, folders: [folder] };
    expect(validateRagImportData(data)).toBe(true);
  });

  it("يُرجع true للمصفوفات الفارغة", () => {
    const data = { documents: [], chunks: [], folders: [] };
    expect(validateRagImportData(data)).toBe(true);
  });

  it("يُرجع true مع exportedAt اختياري", () => {
    const data = { documents: [], chunks: [], folders: [], exportedAt: "2026-09-20T10:00:00Z" };
    expect(validateRagImportData(data)).toBe(true);
  });

  it("يُرجع false للقيمة null", () => {
    expect(validateRagImportData(null)).toBe(false);
  });

  it("يُرجع false للقيمة غير كائن", () => {
    expect(validateRagImportData("string")).toBe(false);
    expect(validateRagImportData(42)).toBe(false);
    expect(validateRagImportData(true)).toBe(false);
  });

  it("يُرجع false عند غياب المصفوفات", () => {
    expect(validateRagImportData({})).toBe(false);
    expect(validateRagImportData({ documents: [] })).toBe(false);
    expect(validateRagImportData({ documents: [], chunks: [] })).toBe(false);
  });

  it("يُرجع false عندما تكون الحقول ليست مصفوفات", () => {
    expect(validateRagImportData({ documents: "not-array", chunks: [], folders: [] })).toBe(false);
    expect(validateRagImportData({ documents: [], chunks: null, folders: [] })).toBe(false);
    expect(validateRagImportData({ documents: [], chunks: [], folders: {} })).toBe(false);
  });
});

describe("importRagData", () => {
  it("يُستورد المستندات والقطع والمجلدات بشكل صحيح", async () => {
    const data = { documents: [document], chunks, folders: [folder] };
    await importRagData(data);

    const docs = await db.rag_documents.toArray();
    const importedChunks = await db.rag_chunks.toArray();
    const foldersResult = await db.rag_folders.toArray();

    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe("doc-1");
    expect(docs[0].fileName).toBe("تقرير-المنتج.pdf");
    expect(importedChunks).toHaveLength(2);
    expect(importedChunks[1].text).toBe("نص القطعة الثانية من التقرير");
    expect(importedChunks[1].embedding).toEqual([0.4, 0.5, 0.6]);
    expect(foldersResult).toHaveLength(1);
    expect(foldersResult[0].path).toBe("/docs");
  });

  it("يُحل محل البيانات الموجودة", async () => {
    // First import
    await importRagData({ documents: [document], chunks, folders: [folder] });

    // Second import with different data
    const newDoc: RagDocument = { ...document, id: "doc-2", fileName: "ملف-جديد.pdf" };
    await importRagData({ documents: [newDoc], chunks: [], folders: [] });

    const docs = await db.rag_documents.toArray();
    const importedChunks = await db.rag_chunks.toArray();
    const foldersResult = await db.rag_folders.toArray();

    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe("doc-2");
    expect(importedChunks).toHaveLength(0);
    expect(foldersResult).toHaveLength(0);
  });

  it("يُفرغ الجداول عند استيراد بيانات فارغة", async () => {
    await importRagData({ documents: [document], chunks, folders: [folder] });
    await importRagData({ documents: [], chunks: [], folders: [] });

    expect(await db.rag_documents.count()).toBe(0);
    expect(await db.rag_chunks.count()).toBe(0);
    expect(await db.rag_folders.count()).toBe(0);
  });
});
