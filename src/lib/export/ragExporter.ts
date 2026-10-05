import { db } from "@/lib/db/db";
import { downloadFile } from "./sessionExporter";

export async function exportRagDataAsJSON(): Promise<string> {
  const [documents, chunks, folders] = await Promise.all([
    db.rag_documents.toArray(),
    db.rag_chunks.toArray(),
    db.rag_folders.toArray(),
  ]);
  return JSON.stringify({ documents, chunks, folders, exportedAt: new Date().toISOString() }, null, 2);
}

export async function downloadRagData(): Promise<void> {
  const json = await exportRagDataAsJSON();
  downloadFile(json, `shura-rag-export-${Date.now()}.json`, "application/json");
}
