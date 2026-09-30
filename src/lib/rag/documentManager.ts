/**
 * Document management: indexing pipeline, CRUD operations.
 * 
 * Flow: upload file → extract text → chunk → embed → store in Dexie → add to HNSW index
 */

import { db } from "@/lib/db/db";
import { newId } from "@/lib/id";
import { chunkText } from "./chunker";
import { OnnxEmbedder, EMBEDDING_MODELS } from "./embedder";
import { extractText, detectFileType } from "./fileProcessor";
import { getVectorIndex, clearAllIndexes } from "./vectorIndex";
import type { RagDocument, RagChunk, RagPersistence, RagSettings } from "@/types";

export interface IndexDocumentOptions {
  persistence: RagPersistence;
  sessionId?: string;
  folderId?: string;
  settings: RagSettings;
}

/**
 * Index a document: extract text, chunk, embed, store.
 */
export async function indexDocument(
  file: File,
  options: IndexDocumentOptions,
): Promise<RagDocument> {
  const { persistence, sessionId, folderId, settings } = options;
  const fileType = detectFileType(file.name);
  const documentId = newId("rag");

  // Create document record
  const doc: RagDocument = {
    id: documentId,
    source: folderId ? "external" : "upload",
    persistence,
    fileName: file.name,
    fileType,
    fileSize: file.size,
    status: "indexing",
    uploadedAt: Date.now(),
    sessionId,
    folderId,
    chunkCount: 0,
    embeddingModelId: settings.embeddingModelId,
  };

  await db.rag_documents.put(doc);

  try {
    // 1. Extract text
    const extracted = await extractText(file, file.name);

    // 2. Chunk text
    const chunks = chunkText(extracted.text, {
      chunkSize: settings.chunkSize,
      overlap: settings.chunkOverlap,
    });

    // 3. Get embedder
    const model = EMBEDDING_MODELS.find((m) => m.id === settings.embeddingModelId)
      ?? EMBEDDING_MODELS[0];
    const embedder = new OnnxEmbedder(model.id, model.dimensions);
    await embedder.initialize();

    // 4. Embed chunks in batch
    const chunkTexts = chunks.map((c) => c.text);
    const embeddings = await embedder.embedBatch(chunkTexts);

    // 5. Store chunks in Dexie
    const ragChunks: RagChunk[] = chunks.map((chunk, i) => ({
      id: newId("chunk"),
      documentId,
      chunkIndex: i,
      text: chunk.text,
      embedding: embeddings[i],
      metadata: {
        source: file.name,
        timestamp: Date.now(),
      },
    }));

    await db.rag_chunks.bulkPut(ragChunks);

    // 6. Add to HNSW index
    const index = getVectorIndex(settings.embeddingModelId, model.dimensions);
    await index.addVectors(
      ragChunks.map((c) => ({ chunkId: c.id, vector: c.embedding })),
    );

    // 7. Update document status
    doc.status = "indexed";
    doc.chunkCount = ragChunks.length;
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
 * Delete a document and all its chunks.
 */
export async function deleteDocument(documentId: string): Promise<void> {
  await db.transaction("rw", [db.rag_documents, db.rag_chunks], async () => {
    await db.rag_chunks.where("documentId").equals(documentId).delete();
    await db.rag_documents.delete(documentId);
  });
}

/**
 * Get all documents, optionally filtered by source.
 */
export async function getDocuments(filter?: {
  source?: RagDocument["source"];
  persistence?: RagPersistence;
}): Promise<RagDocument[]> {
  let docs = await db.rag_documents.toArray();
  if (filter?.source) {
    docs = docs.filter((d) => d.source === filter.source);
  }
  if (filter?.persistence) {
    docs = docs.filter((d) => d.persistence === filter.persistence);
  }
  return docs;
}

/**
 * Get all chunks for a document.
 */
export async function getChunks(documentId: string): Promise<RagChunk[]> {
  return db.rag_chunks.where("documentId").equals(documentId).sortBy("chunkIndex");
}

/**
 * Get all chunks (for index building).
 */
export async function getAllChunks(): Promise<RagChunk[]> {
  return db.rag_chunks.toArray();
}

/**
 * Delete all temporary documents and their chunks.
 */
export async function cleanupTempDocuments(): Promise<number> {
  const tempDocs = await db.rag_documents.where("persistence").equals("temp").toArray();
  let count = 0;
  for (const doc of tempDocs) {
    await deleteDocument(doc.id);
    count++;
  }
  return count;
}

/**
 * Delete temp documents for a specific session.
 */
export async function cleanupTempDocumentsForSession(sessionId: string): Promise<number> {
  const tempDocs = await db.rag_documents
    .where("persistence")
    .equals("temp")
    .and((d) => d.sessionId === sessionId)
    .toArray();
  let count = 0;
  for (const doc of tempDocs) {
    await deleteDocument(doc.id);
    count++;
  }
  return count;
}

/**
 * Re-index all documents with a new embedding model.
 * Deletes old chunks and re-embeds everything.
 */
export async function reindexAllDocuments(
  newSettings: RagSettings,
): Promise<void> {
  const docs = await getDocuments();
  
  // Delete all existing chunks
  await db.rag_chunks.clear();
  
  // Clear vector index
  clearAllIndexes();
  
  // Re-index each document
  for (const doc of docs) {
    // In a real implementation, we'd need to re-read the file from disk
    // For now, we just update the model ID
    doc.embeddingModelId = newSettings.embeddingModelId;
    doc.status = "pending";
    await db.rag_documents.put(doc);
  }
}
