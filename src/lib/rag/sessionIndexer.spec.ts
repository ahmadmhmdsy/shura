import { beforeEach, describe, expect, it, vi } from "vitest";
import { uiText } from "@/i18n";
import { en } from "@/i18n/en";
import { db } from "@/lib/db/db";
import type { ChatMessage, RagSettings, SessionMeta } from "@/types";
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
  addVectors: vi.fn(async () => {}),
  modelIds: [] as string[],
}));

vi.mock("./vectorIndex", () => ({
  getVectorIndex: (modelId: string) => {
    vec.modelIds.push(modelId);
    return { addVectors: vec.addVectors };
  },
}));

import {
  indexAllSessions,
  indexSession,
  isSessionIndexed,
  removeSessionIndex,
} from "./sessionIndexer";

const settings = (over: Partial<RagSettings> = {}): RagSettings => ({
  ...DEFAULT_RAG_SETTINGS,
  ...over,
});

const session = (id: string, over: Partial<SessionMeta> = {}): SessionMeta => ({
  id,
  title: "جلسة " + id,
  createdAt: 1,
  updatedAt: 1,
  modelIds: [],
  primaryTarget: null,
  layoutMode: "vertical",
  onDisk: false,
  contextMode: "stateful",
  targets: [],
  ...over,
});

const msg = (
  id: string,
  sessionId: string,
  over: Partial<ChatMessage> = {},
): ChatMessage => ({
  id,
  sessionId,
  turnId: "t1",
  createdAt: 1,
  role: "user",
  kind: "prompt",
  text: "سؤال",
  status: "done",
  attemptId: "a1",
  operationId: "op1",
  attempt: 1,
  superseded: false,
  ...over,
});

beforeEach(async () => {
  await db.rag_documents.clear();
  await db.rag_chunks.clear();
  await db.sessions.clear();
  await db.messages.clear();
  emb.constructorArgs = [];
  emb.initialize.mockClear();
  emb.embedBatch.mockReset();
  emb.embedBatch.mockImplementation(async (texts: string[]) => texts.map(() => [0.1, 0.2]));
  vec.addVectors.mockClear();
  vec.modelIds = [];
});

describe("indexSession", () => {
  it("ينشئ قطعة لكل دور مكتمل (سؤال + جواب)", async () => {
    const messages = [
      msg("u1", "s1", { turnId: "t1", role: "user", text: "سؤال أول", createdAt: 1 }),
      msg("a1", "s1", { turnId: "t1", role: "assistant", text: "جواب أول", createdAt: 2 }),
      msg("u2", "s1", { turnId: "t2", role: "user", text: "سؤال ثانٍ", createdAt: 3 }),
      msg("a2", "s1", { turnId: "t2", role: "assistant", text: "جواب ثانٍ", createdAt: 4 }),
    ];

    const doc = await indexSession(session("s1", { title: "عنوان الجلسة" }), messages, settings());

    expect(doc.status).toBe("indexed");
    expect(doc.source).toBe("session");
    expect(doc.persistence).toBe("persistent");
    expect(doc.fileType).toBe("session");
    expect(doc.fileName).toBe("عنوان الجلسة");
    expect(doc.sessionId).toBe("s1");
    expect(doc.chunkCount).toBe(2);

    // toArray() returns primary-key order (random uuids), so sort by chunkIndex.
    const chunks = await db.rag_chunks
      .where("documentId")
      .equals(doc.id)
      .sortBy("chunkIndex");
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toContain("Session: عنوان الجلسة");
    expect(chunks[0].text).toContain("User: سؤال أول");
    expect(chunks[0].text).toContain("Assistant: جواب أول");
    expect(chunks[0].metadata.source).toBe("عنوان الجلسة");
    expect(chunks[0].metadata.timestamp).toBe(1);

    expect(doc.fileSize).toBe(chunks.reduce((sum, c) => sum + c.text.length, 0));
    expect(emb.initialize).toHaveBeenCalledTimes(1);
    expect(vec.addVectors).toHaveBeenCalledTimes(1);
  });

  it("يتجاهل الرسائل غير المكتملة أو الفارغة", async () => {
    const messages = [
      msg("u1", "s1", { turnId: "t1", role: "user", text: "سؤال" }),
      msg("a1", "s1", { turnId: "t1", role: "assistant", text: "جواب", status: "streaming" }),
      msg("u2", "s1", { turnId: "t2", role: "user", text: "   " }),
      msg("a2", "s1", { turnId: "t2", role: "assistant", text: "جواب ثانٍ" }),
    ];

    const doc = await indexSession(session("s1"), messages, settings());

    expect(doc.chunkCount).toBe(0);
    expect(await db.rag_chunks.count()).toBe(0);
    expect(vec.addVectors).toHaveBeenCalledWith([]);
  });

  it("لا ينشئ قطعة لدور يفتقد أحد الطرفين", async () => {
    const messages = [
      msg("u1", "s1", { turnId: "t1", role: "user", text: "سؤال بلا جواب" }),
      msg("a1", "s1", { turnId: "t2", role: "assistant", text: "جواب بلا سؤال" }),
    ];

    const doc = await indexSession(session("s1"), messages, settings());

    expect(doc.chunkCount).toBe(0);
  });

  it("يستخدم عنوانًا افتراضيًا عربيًا عندما تكون الجلسة بلا عنوان", async () => {
    const messages = [
      msg("u1", "s1", { turnId: "t1", role: "user", text: "س" }),
      msg("a1", "s1", { turnId: "t1", role: "assistant", text: "ج" }),
    ];

    const doc = await indexSession(session("s1", { title: "" }), messages, settings());

    expect(doc.fileName).toBe("جلسة");
    const chunks = await db.rag_chunks.where("documentId").equals(doc.id).toArray();
    expect(chunks[0].metadata.source).toBe("جلسة");
  });

  it("يتبع العنوان الافتراضي لغة الواجهة النشطة (T3.2a)", async () => {
    uiText.setLocale("en");
    try {
      const messages = [
        msg("u1", "s1", { turnId: "t1", role: "user", text: "س" }),
        msg("a1", "s1", { turnId: "t1", role: "assistant", text: "ج" }),
      ];

      const doc = await indexSession(session("s1", { title: "" }), messages, settings());

      expect(doc.fileName).toBe(en.sessions.untitled);
      const chunks = await db.rag_chunks.where("documentId").equals(doc.id).toArray();
      expect(chunks[0].metadata.source).toBe(en.sessions.untitled);
    } finally {
      uiText.setLocale("ar");
    }
  });

  it("يعود إلى النموذج الأول لمعرّف نموذج غير معروف", async () => {
    await indexSession(session("s1"), [], settings({ embeddingModelId: "nope" }));

    expect(emb.constructorArgs).toEqual([["multilingual-e5-small", 384]]);
    // كما في documentManager: مفتاح الفهرس تابع للنموذج الذي أنتج المتجه لا للطلب.
    expect(vec.modelIds).toEqual(["multilingual-e5-small"]);
  });

  it("يستخدم النموذج المطلوب عندما يكون معروفًا", async () => {
    await indexSession(session("s1"), [], settings({ embeddingModelId: "multilingual-e5-base" }));

    expect(emb.constructorArgs).toEqual([["multilingual-e5-base", 768]]);
  });

  it("يسجّل حالة الخطأ ويرمي عندما يفشل التضمين", async () => {
    emb.embedBatch.mockRejectedValue(new Error("inference failed"));

    await expect(indexSession(session("s1"), [], settings())).rejects.toThrow("inference failed");

    const docs = await db.rag_documents.toArray();
    expect(docs).toHaveLength(1);
    expect(docs[0].status).toBe("error");
    expect(docs[0].error).toBe("inference failed");
  });

  it("يحوّل الأخطاء غير الكائنية إلى نص", async () => {
    emb.embedBatch.mockRejectedValue("boom");

    await expect(indexSession(session("s1"), [], settings())).rejects.toBe("boom");

    expect((await db.rag_documents.toArray())[0].error).toBe("boom");
  });
});

describe("indexAllSessions", () => {
  const seedSession = async (id: string) => {
    await db.sessions.put(session(id));
    await db.messages.bulkPut([
      msg("u-" + id, id, { turnId: "t1", role: "user", text: "سؤال" }),
      msg("a-" + id, id, { turnId: "t1", role: "assistant", text: "جواب" }),
    ]);
  };

  it("يفهرس كل الجلسات ما عدا الحالية والمفهرسة مسبقًا", async () => {
    await seedSession("s1");
    await seedSession("s2");
    await seedSession("s3");
    await db.rag_documents.put({
      id: "already",
      source: "session",
      persistence: "persistent",
      fileName: "s2",
      fileType: "session",
      fileSize: 0,
      status: "indexed",
      uploadedAt: 1,
      sessionId: "s2",
      chunkCount: 1,
      embeddingModelId: "multilingual-e5-small",
    });

    const count = await indexAllSessions("s1", settings());

    expect(count).toBe(1);
    const docs = await db.rag_documents.where("sessionId").equals("s3").toArray();
    expect(docs).toHaveLength(1);
    expect(docs[0].status).toBe("indexed");
  });

  it("يعيد صفرًا عندما لا توجد جلسات", async () => {
    expect(await indexAllSessions(null, settings())).toBe(0);
  });

  it("يفهرس كل الجلسات عندما لا توجد جلسة حالية", async () => {
    await seedSession("s1");
    await seedSession("s2");

    expect(await indexAllSessions(null, settings())).toBe(2);
  });
});

describe("removeSessionIndex", () => {
  it("يحذف مستندات الجلسة وقطعها", async () => {
    const doc = await indexSession(
      session("s1"),
      [
        msg("u1", "s1", { turnId: "t1", role: "user", text: "س" }),
        msg("a1", "s1", { turnId: "t1", role: "assistant", text: "ج" }),
      ],
      settings(),
    );
    await db.rag_documents.put({
      id: "other",
      source: "session",
      persistence: "persistent",
      fileName: "s2",
      fileType: "session",
      fileSize: 0,
      status: "indexed",
      uploadedAt: 1,
      sessionId: "s2",
      chunkCount: 0,
      embeddingModelId: "m",
    });

    await removeSessionIndex("s1");

    expect(await db.rag_documents.get(doc.id)).toBeUndefined();
    expect(await db.rag_chunks.where("documentId").equals(doc.id).count()).toBe(0);
    expect(await db.rag_documents.get("other")).toBeDefined();
  });

  it("لا يفشل عند عدم وجود فهرس للجلسة", async () => {
    await expect(removeSessionIndex("ghost")).resolves.toBeUndefined();
  });
});

describe("isSessionIndexed", () => {
  it("يعيد false قبل الفهرسة و true بعدها", async () => {
    expect(await isSessionIndexed("s1")).toBe(false);

    await indexSession(session("s1"), [], settings());

    expect(await isSessionIndexed("s1")).toBe(true);
  });
});
