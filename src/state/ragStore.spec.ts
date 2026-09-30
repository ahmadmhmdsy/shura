import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRagStore } from "./ragStore";
import { DEFAULT_RAG_SETTINGS } from "@/types";
import { db } from "@/lib/db/db";

vi.mock("@/lib/db/repos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/repos")>();
  return { ...actual, setSetting: vi.fn(async () => undefined), getSetting: vi.fn(async () => null) };
});

vi.mock("@/lib/rag/folderManager", () => ({
  addExternalFolder: vi.fn(async (path: string, label: string, autoReindex: boolean) => ({
    id: "folder-" + Date.now(), path, label, autoReindex, lastIndexedAt: Date.now(), status: "active" as const,
  })),
  removeExternalFolder: vi.fn(async () => undefined),
  getFolders: vi.fn(async () => []),
}));

describe("ragStore", () => {
  beforeEach(async () => {
    await db.rag_documents.clear();
    await db.rag_chunks.clear();
    await db.rag_folders.clear();
    await db.settings.clear();
    useRagStore.setState({ settings: DEFAULT_RAG_SETTINGS, documents: [], folders: [], loaded: false, loading: false, error: null, indexingErrors: {}, indexingProgress: { totalFiles: 0, completedFiles: 0, currentFile: null, status: "idle" } });
  });

  it("load يجلب الإعدادات والمستندات والمجلدات", async () => {
    await useRagStore.getState().load();
    expect(useRagStore.getState().loaded).toBe(true);
    expect(useRagStore.getState().documents).toEqual([]);
    expect(useRagStore.getState().folders).toEqual([]);
  });

  it("liveQuery: مستند جديد ينتشر تلقائيًا إلى المخزن", async () => {
    await useRagStore.getState().load();
    await db.rag_documents.put({ id: "d1", source: "upload", persistence: "persistent", fileName: "f.pdf", fileType: "pdf", fileSize: 1, status: "indexing", uploadedAt: Date.now(), chunkCount: 0, embeddingModelId: "m" });
    await vi.waitFor(() => expect(useRagStore.getState().documents).toHaveLength(1));
  });

  it("addFolder يستدعي addExternalFolder بالمسار والاسم", async () => {
    await useRagStore.getState().load();
    const { addExternalFolder } = await import("@/lib/rag/folderManager");
    await useRagStore.getState().addFolder("/docs", "مستنداتي", true);
    expect(addExternalFolder).toHaveBeenCalledWith("/docs", "مستنداتي", true, expect.anything());
  });

  it("removeFolder يستدعي removeExternalFolder", async () => {
    await useRagStore.getState().load();
    const { removeExternalFolder } = await import("@/lib/rag/folderManager");
    await useRagStore.getState().removeFolder("folder-1");
    expect(removeExternalFolder).toHaveBeenCalledWith("folder-1");
  });

  it("setIndexingError يسجل خطأ الفهرسة لملف", () => {
    useRagStore.getState().setIndexingError("file-1", "فشل الفهرسة");
    expect(useRagStore.getState().indexingErrors).toEqual({ "file-1": "فشل الفهرسة" });
  });

  it("clearIndexingError يزيل خطأ الفهرسة لملف", () => {
    useRagStore.getState().setIndexingError("file-1", "فشل الفهرسة");
    useRagStore.getState().clearIndexingError("file-1");
    expect(useRagStore.getState().indexingErrors).toEqual({});
  });

  it("indexingErrors تتتبع الأخطاء لكل ملف على حدة", () => {
    useRagStore.getState().setIndexingError("file-1", "خطأ 1");
    useRagStore.getState().setIndexingError("file-2", "خطأ 2");
    expect(useRagStore.getState().indexingErrors).toEqual({
      "file-1": "خطأ 1",
      "file-2": "خطأ 2",
    });
  });

  it("setIndexingProgress يحدّث حالة تقدم الفهرسة", () => {
    useRagStore.getState().setIndexingProgress({ totalFiles: 10, status: "indexing" });
    expect(useRagStore.getState().indexingProgress).toEqual({
      totalFiles: 10,
      completedFiles: 0,
      currentFile: null,
      status: "indexing",
    });
  });

  it("setIndexingProgress يدمج التحديثات الجزئية مع الحالة السابقة", () => {
    useRagStore.getState().setIndexingProgress({ totalFiles: 5 });
    useRagStore.getState().setIndexingProgress({ completedFiles: 2, currentFile: "doc.pdf" });
    expect(useRagStore.getState().indexingProgress).toEqual({
      totalFiles: 5,
      completedFiles: 2,
      currentFile: "doc.pdf",
      status: "idle",
    });
  });

  it("تتبع تقدم الفهرسة أثناء فهرسة الملفات", () => {
    const { setIndexingProgress } = useRagStore.getState();
    setIndexingProgress({ totalFiles: 3, status: "indexing" });
    setIndexingProgress({ currentFile: "a.pdf" });
    setIndexingProgress({ completedFiles: 1 });
    setIndexingProgress({ currentFile: "b.pdf" });
    setIndexingProgress({ completedFiles: 2 });
    setIndexingProgress({ currentFile: "c.pdf" });
    setIndexingProgress({ completedFiles: 3, status: "idle" });
    expect(useRagStore.getState().indexingProgress).toEqual({
      totalFiles: 3,
      completedFiles: 3,
      currentFile: "c.pdf",
      status: "idle",
    });
  });
});
