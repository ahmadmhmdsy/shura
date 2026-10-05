import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/db";
import type { RagDocument, RagTempCleanup } from "@/types";
import {
  cleanupOrphanedTempFiles,
  cleanupTempFiles,
  getTempDocumentCount,
  getTempDocumentSize,
  scheduleTempCleanup,
} from "./tempCleanup";

// كانت هذه الاختبارات تثبّت خطأً إنتاجيًا: مخطط rag_documents لم يكن يفهرس
// "persistence" فترمي كل مسارات التنظيف SchemaError. أُصلح الخطأ في db.ts (v5)،
// وصارت الاختبارات تتحقق من السلوك الصحيح: حذف المؤقتات وحدها وإبقاء الدائمة.

const doc = (id: string, over: Partial<RagDocument> = {}): RagDocument => ({
  id,
  source: "upload",
  persistence: "temp",
  fileName: id + ".txt",
  fileType: "txt",
  fileSize: 100,
  status: "indexed",
  uploadedAt: 1,
  chunkCount: 1,
  embeddingModelId: "multilingual-e5-small",
  ...over,
});

const ids = async (): Promise<string[]> =>
  (await db.rag_documents.toArray()).map((d) => d.id).sort();

beforeEach(async () => {
  await db.rag_documents.clear();
  await db.rag_chunks.clear();
  vi.restoreAllMocks();
});

describe("cleanupTempFiles", () => {
  it("after_turn بلا معرّف جلسة: يعيد صفرًا ولا يلمس قاعدة البيانات", async () => {
    await db.rag_documents.put(doc("t1", { sessionId: "s1" }));

    expect(await cleanupTempFiles("after_turn")).toBe(0);
    expect(await db.rag_documents.count()).toBe(1);
  });

  it("manual: لا يحذف شيئًا", async () => {
    await db.rag_documents.put(doc("t1", { sessionId: "s1" }));

    expect(await cleanupTempFiles("manual", "s1")).toBe(0);
    expect(await db.rag_documents.count()).toBe(1);
  });

  it("قيمة زمنية غير معروفة: تعامل كعدم حذف", async () => {
    await db.rag_documents.put(doc("t1", { sessionId: "s1" }));

    expect(await cleanupTempFiles("bogus" as RagTempCleanup, "s1")).toBe(0);
    expect(await db.rag_documents.count()).toBe(1);
  });

  it("after_turn مع جلسة: يحذف مؤقتات تلك الجلسة وحدها ويُبقي الدائمة", async () => {
    await db.rag_documents.bulkPut([
      doc("t1", { sessionId: "s1" }),
      doc("t2", { sessionId: "s1" }),
      doc("t3", { sessionId: "s2" }),
      doc("p1", { sessionId: "s1", persistence: "persistent" }),
    ]);

    expect(await cleanupTempFiles("after_turn", "s1")).toBe(2);
    expect(await ids()).toEqual(["p1", "t3"]);
  });

  it("after_session: يحذف كل المؤقتات ويُبقي الدائمة", async () => {
    await db.rag_documents.bulkPut([
      doc("t1", { sessionId: "s1" }),
      doc("t2", { sessionId: "s2" }),
      doc("p1", { persistence: "persistent" }),
    ]);

    expect(await cleanupTempFiles("after_session")).toBe(2);
    expect(await ids()).toEqual(["p1"]);
  });
});

describe("cleanupOrphanedTempFiles", () => {
  it("يحذف مؤقتات الجلسات السابقة ويُبقي الدائمة", async () => {
    await db.rag_documents.bulkPut([
      doc("t1", { sessionId: "old" }),
      doc("t2", { sessionId: "older" }),
      doc("p1", { persistence: "persistent" }),
    ]);

    expect(await cleanupOrphanedTempFiles()).toBe(2);
    expect(await ids()).toEqual(["p1"]);
  });
});

describe("scheduleTempCleanup", () => {
  it("after_turn: ينفّذ التنظيف فعليًا لتلك الجلسة", async () => {
    await db.rag_documents.put(doc("t1", { sessionId: "s1" }));

    await scheduleTempCleanup("after_turn", "s1");

    expect(await db.rag_documents.count()).toBe(0);
  });

  it("لا ينفّذ أي تنظيف لبقية الأزمنة", async () => {
    await db.rag_documents.put(doc("t1", { sessionId: "s1" }));

    await scheduleTempCleanup("after_session", "s1");
    await scheduleTempCleanup("manual", "s1");

    expect(await db.rag_documents.count()).toBe(1);
  });
});

describe("getTempDocumentCount / getTempDocumentSize", () => {
  it("يعدّ المؤقتات وحدها ويجمع أحجامها", async () => {
    await db.rag_documents.bulkPut([
      doc("t1", { fileSize: 100 }),
      doc("t2", { fileSize: 250 }),
      doc("p1", { fileSize: 999, persistence: "persistent" }),
    ]);

    expect(await getTempDocumentCount()).toBe(2);
    expect(await getTempDocumentSize()).toBe(350);
  });

  it("يعيدان صفرًا مع قاعدة فارغة", async () => {
    expect(await getTempDocumentCount()).toBe(0);
    expect(await getTempDocumentSize()).toBe(0);
  });
});
