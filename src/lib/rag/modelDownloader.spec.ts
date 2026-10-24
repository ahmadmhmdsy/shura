import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/db";
import {
  deleteModel,
  downloadModel,
  getDownloadedModels,
  getModelDownloadStatus,
  isModelDownloaded,
} from "./modelDownloader";
import { putModel } from "./modelCache";
import { getModelInfo } from "./modelCatalog";
import { verifyDigest } from "./verifiedDownload";

// The fixtures stream a few fake bytes; the real digest check has its own spec
// (verifiedDownload.spec.ts). Here it is a spy, so the wiring can be asserted.
vi.mock("./verifiedDownload", () => ({ assertWithinSize: vi.fn(), verifyDigest: vi.fn(async () => {}) }));

const mockFetch = vi.fn();

/** A fetch Response double exposing a ReadableStream-like reader. */
function streamResponse(chunks: number[][], contentLength?: number) {
  const bytes = chunks.map((c) => new Uint8Array(c));
  let i = 0;
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-length"
          ? contentLength === undefined
            ? null
            : String(contentLength)
          : null,
    },
    body: {
      getReader: () => ({
        read: async () =>
          i < bytes.length ? { done: false, value: bytes[i++] } : { done: true, value: undefined },
      }),
    },
  };
}

beforeEach(async () => {
  await db.rag_models.clear();
  await db.rag_model_blobs.clear();
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

describe("downloadModel", () => {
  it("ينزّل النموذج ويسجّله في IndexedDB بحجمه الكامل", async () => {
    mockFetch.mockResolvedValue(streamResponse([[1, 2, 3], [4, 5]], 5));

    await downloadModel("multilingual-e5-small");

    const stored = await db.rag_models.get("multilingual-e5-small");
    expect(stored).toBeDefined();
    expect(stored?.label).toBe("Multilingual E5 Small (recommended for Arabic)");
    expect(stored?.dimensions).toBe(384);
    expect(stored?.sizeBytes).toBe(5);
    expect(stored?.downloadedAt).toBeTypeOf("number");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0][0])).toContain("multilingual-e5-small");
  });

  it("يخزّن بايتات النموذج في rag_model_blobs لا في الصف الوصفي", async () => {
    mockFetch.mockResolvedValue(streamResponse([[1, 2, 3], [4, 5]], 5));

    await downloadModel("multilingual-e5-small");

    const blob = await db.rag_model_blobs.get("multilingual-e5-small");
    expect(blob?.bytes.byteLength).toBe(5);
    expect(new Uint8Array(blob!.bytes)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    // الصف الوصفي يبقى خفيفًا: لا بايتات فيه.
    expect(Object.keys((await db.rag_models.get("multilingual-e5-small"))!).sort()).toEqual([
      "dimensions", "downloadedAt", "id", "label", "modelId", "sizeBytes",
    ]);
  });

  it("يبلّغ عن تقدّم التنزيل بالنسب المئوية", async () => {
    mockFetch.mockResolvedValue(streamResponse([[1, 2], [3, 4]], 4));
    const onProgress = vi.fn();

    await downloadModel("all-MiniLM-L6-v2", onProgress);

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, { loaded: 2, total: 4, percent: 50 });
    expect(onProgress).toHaveBeenNthCalledWith(2, { loaded: 4, total: 4, percent: 100 });
  });

  it("لا يبلّغ عن التقدّم عندما يغيب ترويسة content-length", async () => {
    mockFetch.mockResolvedValue(streamResponse([[1, 2]], undefined));
    const onProgress = vi.fn();

    await downloadModel("multilingual-e5-base", onProgress);

    expect(onProgress).not.toHaveBeenCalled();
    expect((await db.rag_models.get("multilingual-e5-base"))?.sizeBytes).toBe(2);
  });

  it("checks the bytes against the pinned catalog digest before caching", async () => {
    mockFetch.mockResolvedValue(streamResponse([[1, 2, 3]], 3));
    await downloadModel("multilingual-e5-small");
    expect(verifyDigest).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      getModelInfo("multilingual-e5-small")?.integrity.model,
    );
    expect(String(mockFetch.mock.calls[0][0])).not.toContain("/resolve/main/");
  });

  it("caches nothing when the digest check fails", async () => {
    mockFetch.mockResolvedValue(streamResponse([[1, 2, 3]], 3));
    vi.mocked(verifyDigest).mockRejectedValueOnce(new Error("errors.modelIntegrity"));
    await expect(downloadModel("multilingual-e5-small")).rejects.toThrow("errors.modelIntegrity");
    expect(await db.rag_models.get("multilingual-e5-small")).toBeUndefined();
  });

  it("يرمي خطأ لنموذج غير معروف دون تنزيل", async () => {
    await expect(downloadModel("nope")).rejects.toThrow("Unknown model: nope");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("يرمي خطأ عند فشل التنزيل", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: "Server Error" });

    await expect(downloadModel("multilingual-e5-small")).rejects.toThrow(
      "Download failed: 500 Server Error",
    );
    expect(await db.rag_models.count()).toBe(0);
  });

  it("يرمي خطأ عندما لا تحتوي الاستجابة على جسم", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK", headers: { get: () => null }, body: null });

    await expect(downloadModel("multilingual-e5-small")).rejects.toThrow("No response body");
  });

  it("يقرأ جسمًا كاملًا بلا بثّ (مسار plugin-http على سطح المكتب)", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: (name: string) => (name.toLowerCase() === "content-length" ? "5" : null) },
      body: null,
      arrayBuffer: async () => new Uint8Array([4, 5, 6, 7, 8]).buffer,
    });
    const onProgress = vi.fn();

    await downloadModel("multilingual-e5-small", onProgress);

    expect((await db.rag_models.get("multilingual-e5-small"))?.sizeBytes).toBe(5);
    expect(new Uint8Array((await db.rag_model_blobs.get("multilingual-e5-small"))!.bytes)).toEqual(
      new Uint8Array([4, 5, 6, 7, 8]),
    );
    expect(onProgress).toHaveBeenCalledWith({ loaded: 5, total: 5, percent: 100 });
  });

  it("ينزّل نموذجًا بلا أي قطعة بيانات", async () => {
    mockFetch.mockResolvedValue(streamResponse([], 0));

    await downloadModel("multilingual-e5-small");

    expect((await db.rag_models.get("multilingual-e5-small"))?.sizeBytes).toBe(0);
  });

  it("صفّه مطابق تمامًا لما يكتبه الكاتب المشترك لنفس البايتات (T1.6، NL-05)", async () => {
    mockFetch.mockResolvedValue(streamResponse([[1, 2, 3], [4, 5]], 5));
    await downloadModel("multilingual-e5-small");
    const fromDownloader = await db.rag_models.get("multilingual-e5-small");

    // نفس البايتات عبر الكاتب المشترك، بعد إفراغ الجدول: الفرق الوحيد المسموح
    // هو طابع الوقت، فلو تباعد الوصفان عاد هذا الفحص أحمر.
    await db.rag_models.clear();
    await db.rag_model_blobs.clear();
    await putModel("multilingual-e5-small", new Uint8Array([1, 2, 3, 4, 5]).buffer);
    const fromWriter = await db.rag_models.get("multilingual-e5-small");

    expect(fromDownloader).toEqual({ ...fromWriter, downloadedAt: expect.any(Number) });
  });
});

describe("isModelDownloaded / getModelDownloadStatus", () => {
  it("يعيد false وبيانات صفرية قبل التنزيل", async () => {
    expect(await isModelDownloaded("multilingual-e5-small")).toBe(false);
    expect(await getModelDownloadStatus("multilingual-e5-small")).toEqual({
      downloaded: false,
      sizeBytes: 0,
      downloadedAt: null,
    });
  });

  it("يعيد true والبيانات المسجَّلة بعد التنزيل", async () => {
    mockFetch.mockResolvedValue(streamResponse([[1, 2, 3]], 3));
    await downloadModel("multilingual-e5-small");

    expect(await isModelDownloaded("multilingual-e5-small")).toBe(true);
    const status = await getModelDownloadStatus("multilingual-e5-small");
    expect(status.downloaded).toBe(true);
    expect(status.sizeBytes).toBe(3);
    expect(status.downloadedAt).toBeTypeOf("number");
  });
});

describe("deleteModel / getDownloadedModels", () => {
  it("يحذف نموذجًا منزَّلًا", async () => {
    mockFetch.mockResolvedValue(streamResponse([[1]], 1));
    await downloadModel("multilingual-e5-small");

    await deleteModel("multilingual-e5-small");

    expect(await isModelDownloaded("multilingual-e5-small")).toBe(false);
  });

  it("لا يفشل عند حذف نموذج غير موجود", async () => {
    await expect(deleteModel("ghost")).resolves.toBeUndefined();
  });

  it("يحذف البايتات المخزَّنة مع النموذج", async () => {
    mockFetch.mockResolvedValue(streamResponse([[1, 2, 3]], 3));
    await downloadModel("multilingual-e5-small");
    expect(await db.rag_model_blobs.count()).toBe(1);

    await deleteModel("multilingual-e5-small");

    expect(await db.rag_model_blobs.count()).toBe(0);
  });

  it("يسرد كل النماذج المنزَّلة", async () => {
    expect(await getDownloadedModels()).toEqual([]);

    mockFetch.mockResolvedValue(streamResponse([[1]], 1));
    await downloadModel("multilingual-e5-small");
    mockFetch.mockResolvedValue(streamResponse([[1, 2]], 2));
    await downloadModel("all-MiniLM-L6-v2");

    const models = await getDownloadedModels();
    expect(models.map((m) => m.id).sort()).toEqual(["all-MiniLM-L6-v2", "multilingual-e5-small"]);
  });
});
