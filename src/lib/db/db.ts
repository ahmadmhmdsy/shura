import Dexie from "dexie";
import type { ChatMessage, OperationLease, RagChunk, RagDocument, RagFolder, RagModel, SessionMeta, SessionTombstone, TurnRecord, UsageEvent } from "@/types";

export class ShuraDB extends Dexie {
  sessions!: Dexie.Table<SessionMeta, string>;
  messages!: Dexie.Table<ChatMessage, string>;
  usage_events!: Dexie.Table<UsageEvent, string>;
  settings!: Dexie.Table<{ key: string; value: unknown }, string>;
  turns!: Dexie.Table<TurnRecord, string>;
  tombstones!: Dexie.Table<SessionTombstone, string>;
  operation_leases!: Dexie.Table<OperationLease, string>;
  // [المهمة 9] مفاتيح المزودين مشفّرة على الويب؛ لا تُخزَّن إلا الشيفرة و‎IV.
  credentials!: Dexie.Table<{ providerId: string; iv: string; ciphertext: ArrayBuffer }, string>;
  // [RAG] جداول الفهرسة الدلالية
  rag_documents!: Dexie.Table<RagDocument, string>;
  rag_chunks!: Dexie.Table<RagChunk, string>;
  rag_folders!: Dexie.Table<RagFolder, string>;
  rag_models!: Dexie.Table<RagModel, string>;
  // [RAG] بايتات النماذج في جدول منفصل: صفوف rag_models وصفية، فتبقى قراءتها
  // (isModelDownloaded / getDownloadedModels) خفيفة ولا تسحب مئات الميغابايتات.
  rag_model_blobs!: Dexie.Table<{ id: string; bytes: ArrayBuffer }, string>;

  // The optional name is only for isolated migration tests; production uses "shura".
  constructor(name = "shura") {
    super(name);
    this.version(1).stores({
      sessions: "id, updatedAt",
      messages: "id, sessionId, [sessionId+turnId], createdAt",
      usage_events: "id, sessionId, ts, providerId",
      settings: "key",
    });
    // One declaration per version: a repeated version(2).stores() is ambiguous about
    // which definition owns the upgrade and invites future schema drift.
    this.version(2).stores({
      sessions: "id, updatedAt",
      messages: "id, sessionId, [sessionId+turnId], createdAt",
      usage_events: "id, sessionId, ts, providerId",
      settings: "key",
      turns: "id, sessionId, createdAt, status",
      tombstones: "id, deletedAt",
    }).upgrade(async (tx) => {
      const sessions = tx.table<SessionMeta, string>("sessions");
      const usage = tx.table<UsageEvent, string>("usage_events");
      for (const session of await sessions.toArray()) {
        session.contextMode ??= "stateful";
        session.targets ??= [];
        await sessions.put(session);
      }
      for (const event of await usage.toArray()) {
        event.cacheWriteInputTokens ??= 0;
        await usage.put(event);
      }
    });
    this.version(3).stores({
      sessions: "id, updatedAt",
      messages: "id, sessionId, [sessionId+turnId], createdAt",
      usage_events: "id, sessionId, ts, providerId",
      settings: "key",
      turns: "id, sessionId, createdAt, status",
      tombstones: "id, deletedAt",
      operation_leases: "sessionId, operationId, status, updatedAt",
      credentials: "providerId",
    });
    // [RAG] المخطط v4: جداول الفهرسة الدلالية
    this.version(4).stores({
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
    // [RAG] المخطط v5: الحقل "persistence" كان مستعلمًا عنه في أربع دوال إنتاجية
    // دون أن يكون مفهرسًا، فكان كل مسار لتنظيف الملفات المؤقتة يرمي
    // SchemaError: KeyPath persistence ... is not indexed. إضافة فهرس لا تمسّ
    // الصفوف القائمة: Dexie يبنيه منها. ويُضاف جدول البايتات ليصير كاش النموذج
    // فعّالًا (كان كتابةً بلا قراءة، أي إعادة تنزيل في كل جلسة).
    this.version(5).stores({
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
  }
}

export const db = new ShuraDB();