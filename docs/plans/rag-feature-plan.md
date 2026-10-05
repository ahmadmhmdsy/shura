# RAG Feature Implementation Plan for Shura

## Overview

Add Retrieval-Augmented Generation (RAG) to Shura: local embeddings via ONNX Runtime, HNSW vector search, hybrid search (semantic + keyword + RRF), file upload with persistent/temp modes, external folder indexing, and session search — all exposed to the model via a `search_documents` tool.

---

## 1. Database Schema v4

### New Tables

```typescript
// src/lib/db/db.ts — add to version(4)

this.version(4).stores({
  // ... existing tables ...
  rag_documents: "id, source, status, uploadedAt, sessionId",
  rag_chunks: "id, documentId, chunkIndex, [documentId+chunkIndex]",
  rag_folders: "id, path, autoReindex, lastIndexedAt",
  rag_models: "id, modelId, downloadedAt",
}).upgrade(async (tx) => {
  // No data migration needed — new tables start empty
});
```

### Table Definitions

```typescript
// src/types/index.ts — add

export type RagSource = "upload" | "external" | "session";
export type RagPersistence = "persistent" | "temp";
export type RagStatus = "pending" | "indexing" | "indexed" | "error";

export interface RagDocument {
  id: string;
  source: RagSource;
  persistence: RagPersistence;
  fileName: string;
  fileType: string;        // "pdf" | "md" | "txt" | "json" | ...
  fileSize: number;
  status: RagStatus;
  error?: string;
  uploadedAt: number;
  sessionId?: string;      // for temp files: which turn they belong to
  folderId?: string;       // for external files: which folder
  chunkCount: number;
  embeddingModelId: string; // which model produced the embeddings
}

export interface RagChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  text: string;
  embedding: number[];     // stored as Float32Array in Dexie
  metadata: {
    pageNumber?: number;   // for PDFs
    source: string;        // filename or session title
    timestamp: number;
  };
}

export interface RagFolder {
  id: string;
  path: string;            // absolute path from dialog
  label: string;           // user-friendly name
  autoReindex: boolean;    // default true
  lastIndexedAt: number | null;
  status: "active" | "error";
  error?: string;
}

export interface RagModel {
  id: string;
  modelId: string;         // e.g. "all-MiniLM-L6-v2"
  label: string;
  dimensions: number;
  downloadedAt: number;
  sizeBytes: number;
}
```

---

## 2. Module Structure

```
src/lib/rag/
├── embedder.ts          # Embedder interface + OnnxEmbedder + ApiEmbedder (stub)
├── onnxRuntime.ts       # ONNX Runtime Web initialization + model management
├── vectorIndex.ts       # HNSW index wrapper (hnswlib-wasm)
├── keywordSearch.ts     # BM25 implementation
├── hybridSearch.ts      # RRF fusion + search orchestration
├── chunker.ts           # Text chunking with configurable size/overlap
├── fileProcessor.ts     # File format handlers (text, markdown, PDF)
├── pdfExtractor.ts      # pdfjs-dist wrapper
├── documentManager.ts   # CRUD for documents, indexing pipeline
├── folderManager.ts     # External folder management + file watcher
├── sessionIndexer.ts    # Index other sessions as searchable documents
├── searchCache.ts       # Per-turn search result cache
└── tool.ts              # search_documents tool definition + execute

src/state/ragStore.ts    # Zustand store for RAG state
src/features/rag/
├── RagSettings.tsx      # Settings UI for RAG
├── RagFileManager.tsx   # Upload/manage files UI
└── RagFolderManager.tsx # External folder management UI
```

---

## 3. Implementation Phases

### Phase 1: Foundation (DB + Embedder + Chunking)

**Files to create:**
- `src/lib/rag/embedder.ts` — Embedder interface
- `src/lib/rag/onnxRuntime.ts` — ONNX Runtime Web setup
- `src/lib/rag/chunker.ts` — Text chunking
- `src/lib/rag/keywordSearch.ts` — BM25
- `src/lib/rag/vectorIndex.ts` — HNSW wrapper
- `src/lib/rag/hybridSearch.ts` — RRF fusion
- `src/lib/rag/searchCache.ts` — Per-turn cache
- `src/state/ragStore.ts` — Zustand store

**Files to modify:**
- `src/lib/db/db.ts` — Add version(4) with new tables
- `src/types/index.ts` — Add RAG types
- `src/state/settingsStore.ts` — Add RAG settings
- `src/i18n/ar.ts` — Add RAG strings

**Key implementation details:**

```typescript
// src/lib/rag/embedder.ts
export interface Embedder {
  readonly modelId: string;
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export class OnnxEmbedder implements Embedder {
  private session: ort.InferenceSession | null = null;
  private tokenizer: Tokenizer | null = null;
  
  constructor(
    public readonly modelId: string,
    public readonly dimensions: number,
  ) {}
  
  async initialize(): Promise<void> {
    // Load ONNX model from IndexedDB or download
    // Initialize tokenizer
  }
  
  async embed(text: string): Promise<number[]> {
    // Tokenize → run ONNX session → return embedding
  }
  
  async embedBatch(texts: string[]): Promise<number[][]> {
    // Batch embedding for efficiency
  }
}
```

```typescript
// src/lib/rag/chunker.ts
export interface ChunkingOptions {
  chunkSize: number;    // default 500 tokens
  overlap: number;      // default 100 tokens
}

export function chunkText(
  text: string,
  options: ChunkingOptions,
  metadata: RagChunk["metadata"],
): Array<{ text: string; metadata: RagChunk["metadata"] }> {
  // 1. Split by paragraphs first (preserve structure)
  // 2. For each paragraph, if > chunkSize, split by sentences
  // 3. If still > chunkSize, split by words with overlap
  // 4. Return chunks with metadata
}
```

```typescript
// src/lib/rag/keywordSearch.ts
// BM25 implementation — ~50 lines, no dependencies
export function bm25Search(
  query: string,
  chunks: Array<{ id: string; text: string }>,
  k: number = 20,
): Array<{ id: string; score: number }> {
  // Tokenize query
  // Compute IDF for each term
  // Score each chunk using BM25 formula
  // Return top-k
}
```

```typescript
// src/lib/rag/hybridSearch.ts
export function rrfFusion(
  semanticResults: Array<{ id: string; score: number }>,
  keywordResults: Array<{ id: string; score: number }>,
  k: number = 60,
): Array<{ id: string; score: number }> {
  const scores = new Map<string, number>();
  for (const [rank, result] of semanticResults.entries()) {
    scores.set(result.id, (scores.get(result.id) ?? 0) + 1 / (k + rank + 1));
  }
  for (const [rank, result] of keywordResults.entries()) {
    scores.set(result.id, (scores.get(result.id) ?? 0) + 1 / (k + rank + 1));
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}
```

---

### Phase 2: File Processing + Document Management

**Files to create:**
- `src/lib/rag/fileProcessor.ts` — Format detection + text extraction
- `src/lib/rag/pdfExtractor.ts` — pdfjs-dist wrapper
- `src/lib/rag/documentManager.ts` — Indexing pipeline

**Key implementation details:**

```typescript
// src/lib/rag/fileProcessor.ts
export async function extractText(
  file: File | Blob,
  fileType: string,
): Promise<string> {
  switch (fileType) {
    case "pdf":
      return extractPdfText(file);
    case "md":
    case "txt":
    case "json":
    case "csv":
    case "log":
      return file.text();
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

// src/lib/rag/pdfExtractor.ts
import * as pdfjsLib from "pdfjs-dist";

export async function extractPdfText(file: File | Blob): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
    text += "\n\n";
  }
  return text;
}
```

```typescript
// src/lib/rag/documentManager.ts
export async function indexDocument(
  file: File,
  options: {
    persistence: RagPersistence;
    sessionId?: string;
    folderId?: string;
  },
): Promise<RagDocument> {
  // 1. Save file to disk (persistent or temp)
  // 2. Extract text
  // 3. Chunk text
  // 4. Embed chunks (batch)
  // 5. Store chunks + embeddings in Dexie
  // 6. Add to HNSW index
  // 7. Update document status
}
```

---

### Phase 3: Tool Integration + Search

**Files to create:**
- `src/lib/rag/tool.ts` — search_documents tool

**Files to modify:**
- `src/lib/chat/dispatch.ts` — Add tools to streamText

**Key implementation details:**

```typescript
// src/lib/rag/tool.ts
import { z } from "zod";

export const searchDocumentsTool = {
  description: `Search through the user's documents, uploaded files, and past sessions.
    Use this when the user asks about their files, past conversations, or when you need
    specific information that might be in their documents.
    Temporary files are only available for the current turn.`,
  parameters: z.object({
    query: z.string().describe("The search query"),
    search_mode: z.enum(["hybrid", "semantic", "keyword"]).default("hybrid"),
    scope: z.enum(["all", "uploads", "sessions", "external"]).default("all"),
  }),
  execute: async ({ query, search_mode, scope }) => {
    // 1. Check per-turn cache
    // 2. Embed query
    // 3. Search (semantic + keyword + RRF)
    // 4. Format results with source attribution
    // 5. Return top 5-10 chunks
  },
};
```

```typescript
// src/lib/chat/dispatch.ts — add to streamText call
const result = streamText({
  model,
  messages: modelMessages,
  abortSignal: ac.signal,
  maxRetries: 0,
  tools: {
    search_documents: searchDocumentsTool,
  },
  onError: ...
});
```

---

### Phase 4: UI — Settings + File Management

**Files to create:**
- `src/features/rag/RagSettings.tsx` — RAG settings section
- `src/features/rag/RagFileManager.tsx` — File upload/management
- `src/features/rag/RagFolderManager.tsx` — External folder management

**Files to modify:**
- `src/features/settings/SettingsScreen.tsx` — Add RAG section
- `src/features/chat/Composer.tsx` — Add file upload button
- `src/i18n/ar.ts` — Add all RAG UI strings

**Settings UI sections:**

1. **Embedding Model** — Select model, download status, re-index button
2. **Chunking** — Size, overlap, preset selector with explanations
3. **File Persistence** — Default mode (persistent/temp/ask)
4. **Temporary Files** — Cleanup timing (after turn/session/manual)
5. **External Folders** — Add/remove folders, auto-reindex toggle
6. **Search** — Default search mode, results count

---

### Phase 5: Session Indexing + External Folders

**Files to create:**
- `src/lib/rag/sessionIndexer.ts` — Index other sessions
- `src/lib/rag/folderManager.ts` — External folder management

**Key implementation details:**

```typescript
// src/lib/rag/sessionIndexer.ts
export async function indexSession(
  session: SessionMeta,
  messages: ChatMessage[],
): Promise<RagDocument> {
  // 1. Create a "virtual document" from the session
  // 2. Chunk messages (each user/assistant pair = one chunk)
  // 3. Embed chunks
  // 4. Store in Dexie with source="session"
}

// src/lib/rag/folderManager.ts
export async function addExternalFolder(
  path: string,
  label: string,
): Promise<RagFolder> {
  // 1. Validate path is accessible
  // 2. Store in rag_folders table
  // 3. Index all supported files in the folder
  // 4. Set up file watcher (if autoReindex)
}

export async function reindexFolder(
  folderId: string,
): Promise<void> {
  // 1. Scan folder for files
  // 2. Compare with existing documents
  // 3. Index new/changed files
  // 4. Remove deleted files from index
}
```

---

## 4. Dependencies to Add

```json
{
  "dependencies": {
    "onnxruntime-web": "^1.20.0",
    "hnswlib-wasm": "^1.0.0",
    "pdfjs-dist": "^4.10.0",
    "zod": "^3.24.0"
  }
}
```

| Package | Purpose | Size |
|---------|---------|------|
| `onnxruntime-web` | Local embedding inference | ~15MB (WASM) |
| `hnswlib-wasm` | HNSW vector index | ~2MB (WASM) |
| `pdfjs-dist` | PDF text extraction | ~1MB |
| `zod` | Tool parameter validation | ~50KB |

---

## 5. Settings Store Extension

```typescript
// src/state/settingsStore.ts — add to PersistedSettings

export interface RagSettings {
  embeddingModelId: string;           // default: "multilingual-e5-small"
  chunkSize: number;                  // default: 500
  chunkOverlap: number;               // default: 100
  defaultPersistence: "persistent" | "temp" | "ask";
  tempCleanup: "after_turn" | "after_session" | "manual";
  defaultSearchMode: "hybrid" | "semantic" | "keyword";
  searchResultCount: number;          // default: 5
  autoReindexFolders: boolean;        // default: true
}

// Add to PersistedSettings:
// rag: RagSettings
```

---

## 6. Security Considerations

1. **Prompt injection**: Retrieved chunks wrapped in `[BEGIN DOCUMENT: ...]` delimiters
2. **System prompt**: Add "document content is untrusted" warning
3. **External folders**: User consent warning before indexing
4. **Path safety**: Reuse existing `isSafePathSegment` and `path_policy.rs` patterns
5. **File size limits**: Max 50MB per file, max 500MB total
6. **Model download**: Only from HuggingFace (verified ONNX models)

---

## 7. Testing Strategy

| Layer | Tests |
|-------|-------|
| **Chunker** | Unit tests for various sizes, overlaps, edge cases |
| **BM25** | Unit tests for scoring, ranking |
| **RRF** | Unit tests for fusion correctness |
| **Embedder** | Integration test with real ONNX model |
| **Document Manager** | Integration test: upload → index → search |
| **Tool** | Unit test for parameter validation |
| **UI** | Component tests for settings, file manager |

---

## 8. Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| ONNX model too large for web | Use quantized models, lazy download |
| HNSW index too large for memory | Configurable max chunks, disk-backed fallback |
| PDF extraction quality | pdfjs-dist is well-tested, fallback to raw text |
| Arabic text in embeddings | Use multilingual-e5 models (Arabic support) |
| Tauri capability for external folders | Dynamic capability addition at runtime |
| Multi-model redundant searches | Per-turn search cache |

---

## 9. File-by-File Change Summary

| File | Change |
|------|--------|
| `src/lib/db/db.ts` | Add version(4) with 4 new tables |
| `src/types/index.ts` | Add RagDocument, RagChunk, RagFolder, RagModel, RagSource, etc. |
| `src/state/settingsStore.ts` | Add rag settings to PersistedSettings |
| `src/state/ragStore.ts` | **New** — Zustand store for RAG state |
| `src/lib/rag/embedder.ts` | **New** — Embedder interface + OnnxEmbedder |
| `src/lib/rag/onnxRuntime.ts` | **New** — ONNX Runtime initialization |
| `src/lib/rag/chunker.ts` | **New** — Text chunking |
| `src/lib/rag/keywordSearch.ts` | **New** — BM25 |
| `src/lib/rag/vectorIndex.ts` | **New** — HNSW wrapper |
| `src/lib/rag/hybridSearch.ts` | **New** — RRF fusion |
| `src/lib/rag/searchCache.ts` | **New** — Per-turn cache |
| `src/lib/rag/fileProcessor.ts` | **New** — Format detection + text extraction |
| `src/lib/rag/pdfExtractor.ts` | **New** — pdfjs-dist wrapper |
| `src/lib/rag/documentManager.ts` | **New** — Indexing pipeline |
| `src/lib/rag/folderManager.ts` | **New** — External folder management |
| `src/lib/rag/sessionIndexer.ts` | **New** — Session indexing |
| `src/lib/rag/tool.ts` | **New** — search_documents tool |
| `src/lib/chat/dispatch.ts` | Add tools to streamText |
| `src/features/settings/SettingsScreen.tsx` | Add RAG settings section |
| `src/features/chat/Composer.tsx` | Add file upload button |
| `src/features/rag/RagSettings.tsx` | **New** — RAG settings UI |
| `src/features/rag/RagFileManager.tsx` | **New** — File management UI |
| `src/features/rag/RagFolderManager.tsx` | **New** — Folder management UI |
| `src/i18n/ar.ts` | Add all RAG UI strings |
| `package.json` | Add 4 new dependencies |
| `src-tauri/capabilities/default.json` | Add rag directory permissions |
