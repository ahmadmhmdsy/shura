import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/db";
import type { RagChunk, RagDocument, RagFolder } from "@/types";
import { downloadFile } from "./sessionExporter";
import { downloadRagData, exportRagDataAsJSON } from "./ragExporter";

vi.mock("./sessionExporter", () => ({
  downloadFile: vi.fn(),
}));

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
  vi.mocked(downloadFile).mockClear();
});

describe("exportRagDataAsJSON", () => {
  it("يُصدر المستندات والقطع والمجلدات كائنات JSON كاملة", async () => {
    await db.rag_documents.add(document);
    await db.rag_chunks.bulkAdd(chunks);
    await db.rag_folders.add(folder);

    const json = await exportRagDataAsJSON();
    const parsed = JSON.parse(json);

    expect(parsed.documents).toHaveLength(1);
    expect(parsed.documents[0].id).toBe("doc-1");
    expect(parsed.documents[0].fileName).toBe("تقرير-المنتج.pdf");
    expect(parsed.chunks).toHaveLength(2);
    expect(parsed.chunks[1].text).toBe("نص القطعة الثانية من التقرير");
    expect(parsed.chunks[1].embedding).toEqual([0.4, 0.5, 0.6]);
    expect(parsed.folders).toHaveLength(1);
    expect(parsed.folders[0].path).toBe("/docs");
    expect(typeof parsed.exportedAt).toBe("string");
  });

  it("يُرجع مصفوفات فارغة عند عدم وجود بيانات", async () => {
    const json = await exportRagDataAsJSON();
    const parsed = JSON.parse(json);

    expect(parsed.documents).toEqual([]);
    expect(parsed.chunks).toEqual([]);
    expect(parsed.folders).toEqual([]);
  });
});

describe("downloadRagData", () => {
  it("يُحمّل ملف JSON باسم ونوع صحيحين", async () => {
    await db.rag_documents.add(document);

    await downloadRagData();

    expect(downloadFile).toHaveBeenCalledTimes(1);
    const [content, filename, mimeType] = vi.mocked(downloadFile).mock.calls[0];
    expect(mimeType).toBe("application/json");
    expect(filename).toMatch(/^shura-rag-export-\d+\.json$/);
    const parsed = JSON.parse(content);
    expect(parsed.documents).toHaveLength(1);
    expect(parsed.documents[0].id).toBe("doc-1");
  });
});
