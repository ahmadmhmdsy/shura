import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/db";
import { memoryFileSink, setFileSink, type FileSink } from "@/lib/markdown/sink";
import type { RagChunk, RagDocument, RagFolder, RagSettings } from "@/types";
import { DEFAULT_RAG_SETTINGS } from "@/types";

const docMgr = vi.hoisted(() => ({ indexDocument: vi.fn() }));

vi.mock("./documentManager", () => ({
  indexDocument: (...args: unknown[]) => docMgr.indexDocument(...args),
}));

import {
  addExternalFolder,
  autoReindexFolders,
  getFolders,
  indexFolder,
  reindexFolder,
  removeExternalFolder,
  updateFolder,
} from "./folderManager";

const settings = (over: Partial<RagSettings> = {}): RagSettings => ({
  ...DEFAULT_RAG_SETTINGS,
  ...over,
});

const folder = (id: string, over: Partial<RagFolder> = {}): RagFolder => ({
  id,
  path: "C:/docs",
  label: "مستندات",
  autoReindex: true,
  lastIndexedAt: null,
  status: "active",
  ...over,
});

const storedDoc = (id: string, over: Partial<RagDocument> = {}): RagDocument => ({
  id,
  source: "external",
  persistence: "persistent",
  fileName: "a.txt",
  fileType: "txt",
  fileSize: 10,
  status: "indexed",
  uploadedAt: 1,
  folderId: "f1",
  chunkCount: 1,
  embeddingModelId: "m",
  ...over,
});

const storedChunk = (id: string, documentId: string): RagChunk => ({
  id,
  documentId,
  chunkIndex: 0,
  text: "نص",
  embedding: [0.1],
  metadata: { source: "a.txt", timestamp: 1 },
});

let sink: FileSink & { reset(): void; tree(): string[] };

beforeEach(async () => {
  await db.rag_folders.clear();
  await db.rag_documents.clear();
  await db.rag_chunks.clear();
  sink = memoryFileSink();
  setFileSink(sink);
  docMgr.indexDocument.mockReset();
  docMgr.indexDocument.mockResolvedValue({ id: "generated", status: "indexed" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("addExternalFolder", () => {
  it("ينشئ المجلد ويفهرسه فورًا ويحدّث وقت الفهرسة", async () => {
    await sink.writeFile("C:/docs/notes.txt", "محتوى");

    const created = await addExternalFolder("C:/docs", "مستنداتي", true, settings());

    expect(created.status).toBe("active");
    expect(created.lastIndexedAt).toBeNull();
    expect(created.autoReindex).toBe(true);
    expect(created.path).toBe("C:/docs");

    const stored = await db.rag_folders.get(created.id);
    expect(stored?.label).toBe("مستنداتي");
    expect(stored?.lastIndexedAt).toBeTypeOf("number");
    expect(docMgr.indexDocument).toHaveBeenCalledTimes(1);
    expect(docMgr.indexDocument.mock.calls[0][1]).toMatchObject({
      persistence: "persistent",
      folderId: created.id,
    });
  });

  it("ينشئ المجلد حتى عندما يكون فارغًا", async () => {
    const created = await addExternalFolder("C:/empty", "فارغ", false, settings());

    expect(await db.rag_folders.count()).toBe(1);
    expect(docMgr.indexDocument).not.toHaveBeenCalled();
    expect((await db.rag_folders.get(created.id))?.lastIndexedAt).toBeTypeOf("number");
  });
});

describe("indexFolder", () => {
  it("يرمي خطأ عندما يكون المجلد غير موجود", async () => {
    await expect(indexFolder("ghost", settings())).rejects.toThrow("Folder not found");
  });

  it("يفهرس الملفات المدعومة فقط ويتجاهل غيرها", async () => {
    await db.rag_folders.put(folder("f1"));
    await sink.writeFile("C:/docs/a.txt", "أ");
    await sink.writeFile("C:/docs/b.md", "ب");
    await sink.writeFile("C:/docs/c.docx", "ج");

    const count = await indexFolder("f1", settings());

    expect(count).toBe(2);
    expect(docMgr.indexDocument).toHaveBeenCalledTimes(2);
    expect(
      docMgr.indexDocument.mock.calls.map((c) => (c[0] as File).name).sort(),
    ).toEqual(["a.txt", "b.md"]);
  });

  it("يتجاهل الملفات المفهرسة مسبقًا في المجلد نفسه", async () => {
    await db.rag_folders.put(folder("f1"));
    await db.rag_documents.put(storedDoc("existing", { folderId: "f1", fileName: "a.txt" }));
    await sink.writeFile("C:/docs/a.txt", "أ");
    await sink.writeFile("C:/docs/b.md", "ب");

    const count = await indexFolder("f1", settings());

    expect(count).toBe(1);
    expect((docMgr.indexDocument.mock.calls[0][0] as File).name).toBe("b.md");
  });

  it("يواصل بعد فشل فهرسة ملف واحد", async () => {
    await db.rag_folders.put(folder("f1"));
    await sink.writeFile("C:/docs/a.txt", "أ");
    await sink.writeFile("C:/docs/b.md", "ب");
    docMgr.indexDocument
      .mockRejectedValueOnce(new Error("embedding failed"))
      .mockResolvedValue({ id: "ok", status: "indexed" });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const count = await indexFolder("f1", settings());

    expect(count).toBe(1);
    expect(consoleError).toHaveBeenCalled();
  });

  it("يعيد صفرًا عندما يفشل قراءة المجلد ويسجّل الخطأ", async () => {
    await db.rag_folders.put(folder("f1"));
    vi.spyOn(sink, "readDir").mockRejectedValue(new Error("EACCES"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const count = await indexFolder("f1", settings());

    expect(count).toBe(0);
    expect(consoleError).toHaveBeenCalled();
    expect((await db.rag_folders.get("f1"))?.lastIndexedAt).toBeTypeOf("number");
  });
});

describe("removeExternalFolder", () => {
  it("يحذف مستندات المجلد وقطعها وسجل المجلد", async () => {
    await db.rag_folders.put(folder("f1"));
    await db.rag_folders.put(folder("f2"));
    await db.rag_documents.put(storedDoc("d1", { folderId: "f1" }));
    await db.rag_documents.put(storedDoc("d2", { folderId: "f2" }));
    await db.rag_chunks.bulkPut([storedChunk("c1", "d1"), storedChunk("c2", "d2")]);

    await removeExternalFolder("f1");

    expect(await db.rag_folders.get("f1")).toBeUndefined();
    expect(await db.rag_folders.get("f2")).toBeDefined();
    expect(await db.rag_documents.get("d1")).toBeUndefined();
    expect(await db.rag_chunks.where("documentId").equals("d1").count()).toBe(0);
    expect(await db.rag_chunks.where("documentId").equals("d2").count()).toBe(1);
  });

  it("لا يفشل عند حذف مجلد بلا مستندات", async () => {
    await db.rag_folders.put(folder("f1"));

    await expect(removeExternalFolder("f1")).resolves.toBeUndefined();
    expect(await db.rag_folders.count()).toBe(0);
  });
});

describe("reindexFolder", () => {
  it("يحذف المستندات القديمة ثم يعيد فهرسة كل الملفات", async () => {
    await db.rag_folders.put(folder("f1"));
    await db.rag_documents.put(storedDoc("old", { folderId: "f1", fileName: "a.txt" }));
    await db.rag_chunks.put(storedChunk("c1", "old"));
    await sink.writeFile("C:/docs/a.txt", "أ");

    const count = await reindexFolder("f1", settings());

    expect(count).toBe(1);
    expect(await db.rag_documents.get("old")).toBeUndefined();
    expect(await db.rag_chunks.where("documentId").equals("old").count()).toBe(0);
    expect(docMgr.indexDocument).toHaveBeenCalledTimes(1);
  });
});

describe("getFolders / updateFolder", () => {
  it("يسرد المجلدات ويحدّثها", async () => {
    await db.rag_folders.bulkPut([folder("f1"), folder("f2", { label: "ثانٍ" })]);

    expect(await getFolders()).toHaveLength(2);

    await updateFolder("f1", { label: "محدَّث", autoReindex: false });

    const updated = await db.rag_folders.get("f1");
    expect(updated?.label).toBe("محدَّث");
    expect(updated?.autoReindex).toBe(false);
  });

  it("يعيد مصفوفة فارغة عندما لا توجد مجلدات", async () => {
    expect(await getFolders()).toEqual([]);
  });
});

describe("autoReindexFolders", () => {
  it("يتجاهل المجلدات غير المفعّلة", async () => {
    await db.rag_folders.put(folder("f1", { autoReindex: false }));

    expect(await autoReindexFolders(settings())).toBe(0);
    expect(docMgr.indexDocument).not.toHaveBeenCalled();
  });

  it("يتجاهل المجلدات المفهرسة خلال آخر خمس دقائق", async () => {
    await db.rag_folders.put(folder("f1", { lastIndexedAt: Date.now() - 1000 }));

    expect(await autoReindexFolders(settings())).toBe(0);
    expect(docMgr.indexDocument).not.toHaveBeenCalled();
  });

  it("يعيد فهرسة المجلدات القديمة ويجمع العدد", async () => {
    await db.rag_folders.put(
      folder("f1", { path: "C:/a", lastIndexedAt: Date.now() - 10 * 60 * 1000 }),
    );
    await db.rag_folders.put(
      folder("f2", { path: "C:/b", lastIndexedAt: Date.now() - 10 * 60 * 1000 }),
    );
    await sink.writeFile("C:/a/a.txt", "أ");
    await sink.writeFile("C:/b/b.txt", "ب");

    expect(await autoReindexFolders(settings())).toBe(2);
    expect(docMgr.indexDocument).toHaveBeenCalledTimes(2);
  });

  it("يعيد فهرسة المجلد الذي لم يُفهرس قط", async () => {
    await db.rag_folders.put(folder("f1", { lastIndexedAt: null }));
    await sink.writeFile("C:/docs/a.txt", "أ");

    expect(await autoReindexFolders(settings())).toBe(1);
  });

  it("يلتقط فشل فهرسة مجلد ويواصل مع الباقي", async () => {
    await db.rag_folders.put(
      folder("f1", { path: "C:/a", lastIndexedAt: Date.now() - 10 * 60 * 1000 }),
    );
    await db.rag_folders.put(
      folder("f2", { path: "C:/b", lastIndexedAt: Date.now() - 10 * 60 * 1000 }),
    );
    await sink.writeFile("C:/a/a.txt", "أ");
    await sink.writeFile("C:/b/b.txt", "ب");
    // f1 يُحذف من قاعدة البيانات بعد قراءة القائمة فيرمي indexFolder "Folder not found"
    const realGet = db.rag_folders.get.bind(db.rag_folders);
    vi.spyOn(db.rag_folders, "get").mockImplementation((async (key: string) =>
      key === "f1" ? undefined : realGet(key)) as typeof db.rag_folders.get);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const count = await autoReindexFolders(settings());

    expect(count).toBe(1);
    expect(consoleError).toHaveBeenCalled();
  });
});
