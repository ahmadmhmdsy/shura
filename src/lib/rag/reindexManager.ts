/**
 * Re-indexing manager.
 * 
 * Handles re-indexing all documents when the embedding model changes.
 * Since embeddings from different models are incompatible, all documents
 * must be re-embedded when switching models.
 */

import { db } from "@/lib/db/db";
import { clearAllIndexes } from "./vectorIndex";
// الكتالوج انتقل إلى "./modelCatalog" كمصدر وحيد، ويُعاد تصدير getModelInfo من
// هنا حفاظًا على مسار الاستيراد القائم في reindexManager.spec.ts.
export { getModelInfo } from "./modelCatalog";
import type { RagSettings } from "@/types";

export interface ReindexProgress {
  current: number;
  total: number;
  currentFile: string;
}

/**
 * Re-index all documents with a new embedding model.
 * 
 * This is a destructive operation that:
 * 1. Deletes all existing chunks
 * 2. Clears the vector index
 * 3. Re-embeds all documents with the new model
 * 
 * @param newSettings The new RAG settings
 * @param onProgress Optional progress callback
 */
export async function reindexAllDocuments(
  newSettings: RagSettings,
): Promise<void> {
  const docs = await db.rag_documents.toArray();

  // Clear all indexes
  clearAllIndexes();

  // Delete all existing chunks
  await db.rag_chunks.clear();

  // Update all documents to pending status
  for (const doc of docs) {
    doc.status = "pending";
    doc.embeddingModelId = newSettings.embeddingModelId;
    doc.chunkCount = 0;
    await db.rag_documents.put(doc);
  }

  // Note: In a full implementation, we would re-read each file from disk
  // and re-embed it. For now, we just mark them as pending.
  // The actual re-indexing would happen when the user re-uploads files
  // or when we implement file system access.
}

/**
 * Check if re-indexing is needed.
 * 
 * @param oldModelId The previous model ID
 * @param newModelId The new model ID
 */
export function needsReindex(oldModelId: string, newModelId: string): boolean {
  return oldModelId !== newModelId;
}

/**
 * Get the number of documents that need re-indexing.
 */
export async function getReindexDocumentCount(): Promise<number> {
  const docs = await db.rag_documents
    .where("status")
    .equals("pending")
    .count();
  return docs;
}

/**
 * Validate that a model switch is safe.
 * Returns a warning message if re-indexing is needed.
 */
export function validateModelSwitch(
  oldModelId: string,
  newModelId: string,
): { safe: boolean; warning?: string } {
  if (oldModelId === newModelId) {
    return { safe: true };
  }

  return {
    safe: false,
    warning: "تحويل النموذج يتطلب إعادة فهرسة جميع المستندات. التضمينات القديمة ستُحذف.",
  };
}

