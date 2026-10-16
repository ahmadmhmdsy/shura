/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/db";
import { getModelInfo, tokenizerAssetId } from "./modelCatalog";
import {
  deleteModel,
  getModel,
  getModelBytes,
  getTokenizerAsset,
  listModels,
  putModel,
  putModelQuietly,
  putTokenizerAsset,
} from "./modelCache";

/**
 * كاتب كاش النماذج الوحيد (المهمة T1.6، الملاحظة NL-05).
 *
 * يثبّت هذا الملف دعويين لا تراهما اختبارات المسارين:
 * 1. الصف الوصفي دالّة في الكتالوج لا في المستدعي: التسمية والأبعاد تُقرأ من
 *    «modelCatalog»، فيستحيل أن يكتب مسارٌ تسميةً ويكتب آخر أبعادًا أخرى.
 * 2. لا وحدة خارج «modelCache.ts» تكتب في جدولَي الكاش، ولو كُتبت في المستقبل
 *    عاد هذا الفحص أحمر قبل أن يتباعد الصفان.
 */

const RAG_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(RAG_DIR, "..", "..");

const MODEL_ID = "multilingual-e5-small";

/** بايتات نموذج وهمية: المحتوى لا يهم، الطول يهم. */
function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

beforeEach(async () => {
  await db.rag_models.clear();
  await db.rag_model_blobs.clear();
});

describe("كاتب كاش النماذج الوحيد (T1.6، NL-05)", () => {
  it("يكتب الصف من الكتالوج: التسمية والأبعاد لا من المستدعي", async () => {
    const catalog = getModelInfo(MODEL_ID)!;

    await putModel(MODEL_ID, bytes(1, 2, 3, 4, 5));

    expect(await getModel(MODEL_ID)).toEqual({
      id: MODEL_ID,
      modelId: MODEL_ID,
      label: catalog.label,
      dimensions: catalog.dimensions,
      downloadedAt: expect.any(Number),
      sizeBytes: 5,
    });
  });

  it("يخزّن البايتات في جدول البايتات لا في الصف الوصفي", async () => {
    await putModel(MODEL_ID, bytes(7, 8, 9));

    expect(new Uint8Array((await getModelBytes(MODEL_ID))!)).toEqual(new Uint8Array([7, 8, 9]));
    expect(Object.keys((await getModel(MODEL_ID))!).sort()).toEqual([
      "dimensions",
      "downloadedAt",
      "id",
      "label",
      "modelId",
      "sizeBytes",
    ]);
  });

  it("يرفض نموذجًا غير معروف بدل كتابة صف بلا كتالوج", async () => {
    await expect(putModel("ghost-model", bytes(1))).rejects.toThrow("Unknown embedding model");

    expect(await db.rag_models.count()).toBe(0);
    expect(await db.rag_model_blobs.count()).toBe(0);
  });

  it("يمتصّ فشل الكتابة في المسار الكسول ويعيد false بدل أن يرمي", async () => {
    await expect(putModelQuietly("ghost-model", bytes(1))).resolves.toBe(false);
    expect(await db.rag_models.count()).toBe(0);

    await expect(putModelQuietly(MODEL_ID, bytes(2))).resolves.toBe(true);
    expect(await getModel(MODEL_ID)).toBeDefined();
  });

  it("يعيد undefined وnull لغياب النموذج بدل أن يرمي", async () => {
    expect(await getModel(MODEL_ID)).toBeUndefined();
    expect(await getModelBytes(MODEL_ID)).toBeNull();
    expect(await getTokenizerAsset("tokenizer:none:tokenizer.json")).toBeNull();
  });

  it("يسرد النماذج المنزَّلة", async () => {
    expect(await listModels()).toEqual([]);

    await putModel(MODEL_ID, bytes(1));
    await putModel("all-MiniLM-L6-v2", bytes(1));

    expect((await listModels()).map((model) => model.id).sort()).toEqual([
      "all-MiniLM-L6-v2",
      MODEL_ID,
    ]);
  });

  it("يحذف الصف والبايتات وملفَّي المُرمِّز معًا", async () => {
    await putModel(MODEL_ID, bytes(1, 2));
    await putTokenizerAsset(tokenizerAssetId(MODEL_ID, "tokenizer.json"), bytes(3));
    await putTokenizerAsset(tokenizerAssetId(MODEL_ID, "tokenizer_config.json"), bytes(4));
    expect(await db.rag_model_blobs.count()).toBe(3);

    await deleteModel(MODEL_ID);

    expect(await getModel(MODEL_ID)).toBeUndefined();
    expect(await getModelBytes(MODEL_ID)).toBeNull();
    expect(await db.rag_model_blobs.count()).toBe(0);
  });

  it("لا يفشل عند حذف نموذج غير موجود", async () => {
    await expect(deleteModel("ghost-model")).resolves.toBeUndefined();
  });
});

describe("كاتب واحد للجدولين (T1.6، NL-05)", () => {
  const SOURCE_EXT = /\.tsx?$/;
  const SPEC_EXT = /\.spec\.tsx?$/;
  const CACHE_WRITE = /rag_model_blobs\.(put|delete|bulkDelete|clear)|rag_models\.(put|delete|bulkDelete|clear)/;

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...sourceFiles(full));
      else if (SOURCE_EXT.test(entry.name) && !SPEC_EXT.test(entry.name)) out.push(full);
    }
    return out;
  }

  it("لا وحدة خارج modelCache.ts تكتب في جدولَي كاش النماذج", () => {
    const writers = sourceFiles(SRC_DIR)
      .filter((file) => path.basename(file) !== "modelCache.ts")
      .filter((file) => CACHE_WRITE.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(SRC_DIR, file).split(path.sep).join("/"));

    expect(writers).toEqual([]);
  });
});
