import { db } from "@/lib/db/db";
import type { RagDocument, RagChunk, RagFolder } from "@/types";

export interface RagImportData {
  documents: RagDocument[];
  chunks: RagChunk[];
  folders: RagFolder[];
  exportedAt?: string;
}

export function validateRagImportData(data: unknown): data is RagImportData {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    Array.isArray(d.documents) &&
    Array.isArray(d.chunks) &&
    Array.isArray(d.folders)
  );
}

export async function importRagData(data: RagImportData): Promise<void> {
  await db.transaction("rw", [db.rag_documents, db.rag_chunks, db.rag_folders], async () => {
    await db.rag_documents.clear();
    await db.rag_chunks.clear();
    await db.rag_folders.clear();
    await db.rag_documents.bulkAdd(data.documents);
    await db.rag_chunks.bulkAdd(data.chunks);
    await db.rag_folders.bulkAdd(data.folders);
  });
}
