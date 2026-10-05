/**
 * Temporary file cleanup.
 * 
 * Handles deletion of temporary documents based on the user's
 * configured cleanup timing:
 * - after_turn: Delete when the current turn completes
 * - after_session: Delete when the session ends
 * - manual: Only delete when the user clicks "Clear temporary files"
 */

import { db } from "@/lib/db/db";
import { cleanupTempDocuments, cleanupTempDocumentsForSession } from "./documentManager";
import type { RagTempCleanup } from "@/types";

/**
 * Clean up temporary documents based on the configured timing.
 * 
 * @param timing The cleanup timing setting
 * @param sessionId The current session ID (for after_turn cleanup)
 */
export async function cleanupTempFiles(
  timing: RagTempCleanup,
  sessionId?: string,
): Promise<number> {
  switch (timing) {
    case "after_turn":
      // Delete temp files for the current session
      if (sessionId) {
        return cleanupTempDocumentsForSession(sessionId);
      }
      return 0;
    
    case "after_session":
      // Delete all temp files (they belong to the ending session)
      return cleanupTempDocuments();
    
    case "manual":
      // Don't auto-cleanup
      return 0;
    
    default:
      return 0;
  }
}

/**
 * Clean up orphaned temp files on app startup.
 * These are temp files from a previous run that didn't get cleaned up.
 */
export async function cleanupOrphanedTempFiles(): Promise<number> {
  return cleanupTempDocuments();
}

/**
 * Schedule temp file cleanup after a turn completes.
 * Called by the chat controller when a turn finishes.
 */
export async function scheduleTempCleanup(
  timing: RagTempCleanup,
  sessionId: string,
): Promise<void> {
  if (timing === "after_turn") {
    await cleanupTempFiles(timing, sessionId);
  }
}

/**
 * Get the count of temporary documents.
 */
export async function getTempDocumentCount(): Promise<number> {
  const tempDocs = await db.rag_documents
    .where("persistence")
    .equals("temp")
    .count();
  return tempDocs;
}

/**
 * Get the total size of temporary documents.
 */
export async function getTempDocumentSize(): Promise<number> {
  const tempDocs = await db.rag_documents
    .where("persistence")
    .equals("temp")
    .toArray();
  return tempDocs.reduce((sum, doc) => sum + doc.fileSize, 0);
}
