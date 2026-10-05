/**
 * External folder management.
 * 
 * Handles:
 * - Adding/removing external folders
 * - Scanning folders for supported files
 * - Auto-reindexing on file changes
 * - Incremental indexing (only new/changed files)
 */

import { db } from "@/lib/db/db";
import { newId } from "@/lib/id";
import { getFileSink } from "@/lib/markdown/sink";
import { indexDocument } from "./documentManager";
import { isSupportedFileType } from "./fileProcessor";
import type { RagFolder, RagSettings } from "@/types";

/**
 * Add an external folder for indexing.
 * 
 * @param path Absolute path to the folder
 * @param label User-friendly name
 * @param autoReindex Whether to auto-reindex on changes
 * @param settings RAG settings
 */
export async function addExternalFolder(
  path: string,
  label: string,
  autoReindex: boolean,
  settings: RagSettings,
): Promise<RagFolder> {
  const folder: RagFolder = {
    id: newId("folder"),
    path,
    label,
    autoReindex,
    lastIndexedAt: null,
    status: "active",
  };

  await db.rag_folders.put(folder);

  // Initial index
  await indexFolder(folder.id, settings);

  return folder;
}

/**
 * Remove an external folder and all its indexed documents.
 */
export async function removeExternalFolder(folderId: string): Promise<void> {
  // Delete all documents from this folder
  const docs = await db.rag_documents
    .where("folderId")
    .equals(folderId)
    .toArray();

  for (const doc of docs) {
    await db.rag_chunks.where("documentId").equals(doc.id).delete();
    await db.rag_documents.delete(doc.id);
  }

  // Delete the folder record
  await db.rag_folders.delete(folderId);
}

/**
 * Index all files in an external folder.
 */
export async function indexFolder(
  folderId: string,
  settings: RagSettings,
): Promise<number> {
  const folder = await db.rag_folders.get(folderId);
  if (!folder) throw new Error("Folder not found");

  const sink = getFileSink();
  const files = await scanFolder(sink, folder.path);
  
  let count = 0;
  for (const file of files) {
    // Check if already indexed
    const existing = await db.rag_documents
      .where("folderId")
      .equals(folderId)
      .and((d) => d.fileName === file.name)
      .first();

    if (existing) {
      // Check if file has changed (by size or modified time)
      // For now, skip if already indexed
      continue;
    }

    try {
      // Read file content
      const content = await sink.readFile(file.path);
      const blob = new Blob([content], { type: "application/octet-stream" });
      const fileObj = new File([blob], file.name);

      await indexDocument(fileObj, {
        persistence: "persistent",
        folderId,
        settings,
      });
      count++;
    } catch (error) {
      console.error(`Failed to index ${file.name}:`, error);
    }
  }

  // Update folder last indexed time
  await db.rag_folders.update(folderId, {
    lastIndexedAt: Date.now(),
  });

  return count;
}

/**
 * Reindex a folder (force re-index all files).
 */
export async function reindexFolder(
  folderId: string,
  settings: RagSettings,
): Promise<number> {
  // Delete existing documents from this folder
  const docs = await db.rag_documents
    .where("folderId")
    .equals(folderId)
    .toArray();

  for (const doc of docs) {
    await db.rag_chunks.where("documentId").equals(doc.id).delete();
    await db.rag_documents.delete(doc.id);
  }

  // Re-index
  return indexFolder(folderId, settings);
}

/**
 * Scan a folder for supported files.
 */
async function scanFolder(
  sink: ReturnType<typeof getFileSink>,
  path: string,
): Promise<Array<{ name: string; path: string }>> {
  const files: Array<{ name: string; path: string }> = [];
  
  try {
    const entries = await sink.readDir(path);
    for (const entry of entries) {
      const fullPath = path + "/" + entry;
      if (isSupportedFileType(entry)) {
        files.push({ name: entry, path: fullPath });
      }
    }
  } catch (error) {
    console.error(`Failed to scan folder ${path}:`, error);
  }

  return files;
}

/**
 * Get all external folders.
 */
export async function getFolders(): Promise<RagFolder[]> {
  return db.rag_folders.toArray();
}

/**
 * Update folder settings.
 */
export async function updateFolder(
  folderId: string,
  patch: Partial<RagFolder>,
): Promise<void> {
  await db.rag_folders.update(folderId, patch);
}

/**
 * Auto-reindex all folders with autoReindex enabled.
 * Called periodically or on app startup.
 */
export async function autoReindexFolders(settings: RagSettings): Promise<number> {
  const folders = await getFolders();
  let totalCount = 0;

  for (const folder of folders) {
    if (!folder.autoReindex) continue;
    
    // Check if it's been more than 5 minutes since last index
    if (folder.lastIndexedAt && Date.now() - folder.lastIndexedAt < 5 * 60 * 1000) {
      continue;
    }

    try {
      const count = await indexFolder(folder.id, settings);
      totalCount += count;
    } catch (error) {
      console.error(`Auto-reindex failed for ${folder.label}:`, error);
    }
  }

  return totalCount;
}
