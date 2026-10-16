/**
 * Session indexer: indexes other sessions as searchable documents.
 * 
 * Each session becomes a "virtual document" where:
 * - Each user/assistant message pair is a chunk
 * - The session title and metadata are preserved
 * - Chunks are embedded and stored like any other document
 */

import { uiText } from "@/i18n";
import { db } from "@/lib/db/db";
import { newId } from "@/lib/id";
import { OnnxEmbedder, EMBEDDING_MODELS } from "./embedder";
import { getVectorIndex } from "./vectorIndex";
import { currentEmbeddingVersion } from "./embeddingVersion";
import type { ChatMessage, RagDocument, RagChunk, RagSettings, SessionMeta } from "@/types";

/**
 * Index a session as a searchable document.
 * 
 * @param session The session metadata
 * @param messages The session messages
 * @param settings RAG settings
 * @returns The created document
 */
export async function indexSession(
  session: SessionMeta,
  messages: ChatMessage[],
  settings: RagSettings,
): Promise<RagDocument> {
  const documentId = newId("rag");

  // Create document record
  const doc: RagDocument = {
    id: documentId,
    source: "session",
    persistence: "persistent",
    fileName: session.title || uiText.t("sessions.untitled"),
    fileType: "session",
    fileSize: 0,
    status: "indexing",
    uploadedAt: Date.now(),
    sessionId: session.id,
    chunkCount: 0,
    embeddingModelId: settings.embeddingModelId,
  };

  await db.rag_documents.put(doc);

  try {
    // 1. Build chunks from message pairs
    const chunks = buildSessionChunks(messages, session.title);

    // 2. Get embedder
    const model = EMBEDDING_MODELS.find((m) => m.id === settings.embeddingModelId)
      ?? EMBEDDING_MODELS[0];
    const embedder = new OnnxEmbedder(model.id, model.dimensions);
    await embedder.initialize();

    // 3. Embed chunks in batch
    const chunkTexts = chunks.map((c) => c.text);
    const embeddings = await embedder.embedBatch(chunkTexts);

    // 4. Store chunks in Dexie، مخسومةً بهوية النموذج الذي أنتج المتجه فعليًا.
    const embeddingVersion = currentEmbeddingVersion(model.id) ?? undefined;
    const ragChunks: RagChunk[] = chunks.map((chunk, i) => ({
      id: newId("chunk"),
      documentId,
      chunkIndex: i,
      text: chunk.text,
      embedding: embeddings[i],
      embeddingVersion,
      metadata: {
        source: session.title || uiText.t("sessions.untitled"),
        timestamp: chunk.timestamp,
      },
    }));

    await db.rag_chunks.bulkPut(ragChunks);

    // 5. Add to HNSW index
    const index = getVectorIndex(model.id, model.dimensions, embeddingVersion ?? null);
    await index.addVectors(
      ragChunks.map((c) => ({ chunkId: c.id, vector: c.embedding })),
    );

    // 6. Update document status
    doc.status = "indexed";
    doc.chunkCount = ragChunks.length;
    doc.fileSize = chunks.reduce((sum, c) => sum + c.text.length, 0);
    await db.rag_documents.put(doc);

    return doc;
  } catch (error) {
    doc.status = "error";
    doc.error = error instanceof Error ? error.message : String(error);
    await db.rag_documents.put(doc);
    throw error;
  }
}

/**
 * Build chunks from session messages.
 * Each user/assistant pair becomes a chunk.
 */
function buildSessionChunks(
  messages: ChatMessage[],
  sessionTitle: string,
): Array<{ text: string; timestamp: number }> {
  const chunks: Array<{ text: string; timestamp: number }> = [];
  
  // Group messages by turn
  const turns = new Map<string, ChatMessage[]>();
  for (const msg of messages) {
    if (msg.status !== "done" || !msg.text.trim()) continue;
    const group = turns.get(msg.turnId) ?? [];
    group.push(msg);
    turns.set(msg.turnId, group);
  }

  // Create a chunk for each turn
  for (const [, turnMessages] of turns) {
    const sorted = turnMessages.sort((a, b) => a.createdAt - b.createdAt);
    const userMsg = sorted.find((m) => m.role === "user");
    const assistantMsg = sorted.find((m) => m.role === "assistant");

    if (userMsg && assistantMsg) {
      const text = [
        `Session: ${sessionTitle}`,
        `User: ${userMsg.text}`,
        `Assistant: ${assistantMsg.text}`,
      ].join("\n\n");
      
      chunks.push({
        text,
        timestamp: userMsg.createdAt,
      });
    }
  }

  return chunks;
}

/**
 * Index all sessions except the current one.
 * Called on app startup or when explicitly triggered.
 */
export async function indexAllSessions(
  currentSessionId: string | null,
  settings: RagSettings,
): Promise<number> {
  const sessions = await db.sessions.toArray();
  let count = 0;

  for (const session of sessions) {
    if (session.id === currentSessionId) continue;
    
    // Check if already indexed
    const existing = await db.rag_documents
      .where("sessionId")
      .equals(session.id)
      .first();
    if (existing) continue;

    const messages = await db.messages
      .where("sessionId")
      .equals(session.id)
      .sortBy("createdAt");

    await indexSession(session, messages, settings);
    count++;
  }

  return count;
}

/**
 * Remove a session's index when the session is deleted.
 */
export async function removeSessionIndex(sessionId: string): Promise<void> {
  const docs = await db.rag_documents
    .where("sessionId")
    .equals(sessionId)
    .toArray();

  for (const doc of docs) {
    await db.rag_chunks.where("documentId").equals(doc.id).delete();
    await db.rag_documents.delete(doc.id);
  }
}

/**
 * Check if a session is already indexed.
 */
export async function isSessionIndexed(sessionId: string): Promise<boolean> {
  const existing = await db.rag_documents
    .where("sessionId")
    .equals(sessionId)
    .first();
  return existing !== undefined;
}
