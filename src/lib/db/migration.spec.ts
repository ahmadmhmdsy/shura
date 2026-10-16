import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { ShuraDB } from "./db";
import { createSession, deleteSessionData, hasTombstone, importSessionAtomically } from "./repos";
import { meta, oldSession, usageEvent } from "@/test/helpers";
import { currentEmbeddingVersion, isChunkStale } from "@/lib/rag/embeddingVersion";

const DB_NAME = "shura-migration-test";

describe("ShuraDB v2 migration", () => {
  afterEach(async () => {
    await Dexie.delete(DB_NAME);
  });

  it("adds turns and tombstones without removing existing sessions", async () => {
    const legacy = new Dexie(DB_NAME);
    legacy.version(1).stores({
      sessions: "id, updatedAt",
      messages: "id, sessionId, [sessionId+turnId], createdAt",
      usage_events: "id, sessionId, ts, providerId",
      settings: "key",
    });
    await legacy.open();
    await legacy.table("sessions").put(oldSession("s1"));
    await legacy.table("usage_events").put(usageEvent("u1", "s1"));
    await legacy.close();

    const upgraded = new ShuraDB(DB_NAME);
    await upgraded.open();
    const s1 = await upgraded.sessions.get("s1");
    expect(s1).toBeTruthy();
    expect(s1?.contextMode).toBe("stateful");
    expect(s1?.targets).toEqual([]);
    expect((await upgraded.usage_events.toArray())[0]?.cacheWriteInputTokens).toBe(0);
    expect(upgraded.turns).toBeDefined();
    expect(upgraded.tombstones).toBeDefined();
    await upgraded.close();
  });

  it("v5 يضيف فهرس persistence دون فقدان مستندات RAG", async () => {
    const legacy = new Dexie(DB_NAME);
    legacy.version(4).stores({
      sessions: "id, updatedAt",
      messages: "id, sessionId, [sessionId+turnId], createdAt",
      usage_events: "id, sessionId, ts, providerId",
      settings: "key",
      turns: "id, sessionId, createdAt, status",
      tombstones: "id, deletedAt",
      operation_leases: "sessionId, operationId, status, updatedAt",
      credentials: "providerId",
      rag_documents: "id, source, status, uploadedAt, sessionId, folderId",
      rag_chunks: "id, documentId, chunkIndex, [documentId+chunkIndex]",
      rag_folders: "id, path, status",
      rag_models: "id, modelId",
    });
    await legacy.open();
    // المخطط v4 لا يفهرس persistence: الكتابة تمر، والاستعلام يفشل.
    await legacy.table("rag_documents").put({
      id: "d1", source: "upload", persistence: "temp", fileName: "a.txt",
      fileType: "txt", fileSize: 10, status: "indexed", uploadedAt: 1,
      chunkCount: 0, embeddingModelId: "multilingual-e5-small",
    });
    await legacy.close();

    const upgraded = new ShuraDB(DB_NAME);
    await upgraded.open();

    expect((await upgraded.rag_documents.get("d1"))?.persistence).toBe("temp");
    expect(await upgraded.rag_documents.where("persistence").equals("temp").count()).toBe(1);
    expect(upgraded.rag_model_blobs).toBeDefined();
    await upgraded.close();
  });

  it("v6 يختم القطع بهوية التضمين دون فقدان القطع القديمة", async () => {
    const legacy = new Dexie(DB_NAME);
    legacy.version(5).stores({
      sessions: "id, updatedAt",
      messages: "id, sessionId, [sessionId+turnId], createdAt",
      usage_events: "id, sessionId, ts, providerId",
      settings: "key",
      turns: "id, sessionId, createdAt, status",
      tombstones: "id, deletedAt",
      operation_leases: "sessionId, operationId, status, updatedAt",
      credentials: "providerId",
      rag_documents: "id, source, status, uploadedAt, sessionId, folderId, persistence",
      rag_chunks: "id, documentId, chunkIndex, [documentId+chunkIndex]",
      rag_folders: "id, path, status",
      rag_models: "id, modelId",
      rag_model_blobs: "id",
    });
    await legacy.open();
    const legacyChunk = {
      id: "c-old",
      documentId: "d1",
      chunkIndex: 0,
      text: "نص قديم",
      embedding: [0.1, 0.2],
      metadata: { source: "a.txt", timestamp: 1 },
    };
    await legacy.table("rag_chunks").put(legacyChunk);
    await legacy.close();

    const upgraded = new ShuraDB(DB_NAME);
    await upgraded.open();

    // لا حذف: القطعة القديمة باقية كما هي، لكن بلا ختم.
    const kept = await upgraded.rag_chunks.get("c-old");
    expect(kept?.text).toBe("نص قديم");
    expect(kept?.embeddingVersion).toBeUndefined();

    // والفهرس الجديد يُستعلَم به، والدلالة هي المقصودة: بلا ختم = قديمة.
    const active = currentEmbeddingVersion("multilingual-e5-small") as string;
    expect(await upgraded.rag_chunks.where("embeddingVersion").equals(active).count()).toBe(0);
    expect(isChunkStale(kept!, active)).toBe(true);
    expect(isChunkStale({ embeddingVersion: active }, active)).toBe(false);
    await upgraded.close();
  });

  it("keeps a tombstone after deleting a session", async () => {
    await createSession(meta("s2"));
    await deleteSessionData("s2");
    expect(await hasTombstone("s2")).toBe(true);
    expect(await importSessionAtomically(meta("s2"), [], [], [])).toBe("tombstoned");
    expect(await hasTombstone("s2")).toBe(true);
  });
});
