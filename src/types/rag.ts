/**
 * عقود الاسترجاع المعزّز (RAG): المستندات، القطع، المجلدات والنماذج.
 * Domain: rag — documents, chunks, folders, models and settings.
 * مستقل تمامًا عن وحدتي providers/chat.
 */

// === RAG Types ===

export type RagSource = "upload" | "external" | "session";
export type RagPersistence = "persistent" | "temp";
export type RagStatus = "pending" | "indexing" | "indexed" | "error";
export type RagSearchMode = "hybrid" | "semantic" | "keyword";
export type RagSearchScope = "all" | "uploads" | "sessions" | "external";
export type RagTempCleanup = "after_turn" | "after_session" | "manual";

export interface RagDocument {
  id: string;
  source: RagSource;
  persistence: RagPersistence;
  fileName: string;
  fileType: string;
  fileSize: number;
  status: RagStatus;
  error?: string;
  uploadedAt: number;
  sessionId?: string;
  folderId?: string;
  chunkCount: number;
  embeddingModelId: string;
}

export interface RagChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  text: string;
  embedding: number[];
  metadata: {
    pageNumber?: number;
    source: string;
    timestamp: number;
  };
}

export interface RagFolder {
  id: string;
  path: string;
  label: string;
  autoReindex: boolean;
  lastIndexedAt: number | null;
  status: "active" | "error";
  error?: string;
}

export interface RagModel {
  id: string;
  modelId: string;
  label: string;
  dimensions: number;
  downloadedAt: number;
  sizeBytes: number;
}

export interface RagSettings {
  embeddingModelId: string;
  chunkSize: number;
  chunkOverlap: number;
  defaultPersistence: RagPersistence | "ask";
  tempCleanup: RagTempCleanup;
  defaultSearchMode: RagSearchMode;
  searchResultCount: number;
  autoReindexFolders: boolean;
  agentMode: "always" | "toggle";
}

export const DEFAULT_RAG_SETTINGS: RagSettings = {
  embeddingModelId: "multilingual-e5-small",
  chunkSize: 500,
  chunkOverlap: 100,
  defaultPersistence: "ask",
  tempCleanup: "after_turn",
  defaultSearchMode: "hybrid",
  searchResultCount: 5,
  autoReindexFolders: true,
  agentMode: "always",
};
