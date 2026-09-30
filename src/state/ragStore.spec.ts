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
    useRagStore.setState({ settings: DEFAULT_RAG_SETTINGS, documents: [], folders: [], loaded: false, loading: false, error: null });
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
});
