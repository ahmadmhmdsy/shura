/**
 * search_documents tool for the AI SDK.
 * 
 * Exposes RAG search to the model via a tool call.
 * The model can search documents, uploaded files, and past sessions.
 */

import { z } from "zod";
import type { RagModel, RagSearchMode, RagSearchScope, RagSettings } from "@/types";
import { searchCache } from "./searchCache";
import { bm25Search } from "./keywordSearch";
import { hybridSearch, type SearchResult } from "./hybridSearch";
import { getVectorIndex, type VectorSearchResult } from "./vectorIndex";
import { getAllChunks } from "./documentManager";
import { EMBEDDING_MODELS, OnnxEmbedder, isModelLoaded, loadEmbeddingModel } from "./embedder";

export interface SearchDocumentsToolOptions {
  settings: RagSettings;
}

/**
 * Ensure the embedding model is loaded before searching.
 *
 * The model loads lazily on first RAG use instead of on startup. Returns
 * null when loading fails so the caller can answer with a friendly message
 * instead of failing the whole tool call.
 */
async function ensureEmbeddingModel(model: RagModel): Promise<OnnxEmbedder | null> {
  try {
    if (!isModelLoaded()) {
      await loadEmbeddingModel(model.id, model.dimensions);
    }
    return new OnnxEmbedder(model.id, model.dimensions);
  } catch (error) {
    console.error("Failed to load embedding model:", error);
    return null;
  }
}

/**
 * Create the search_documents tool.
 */
export function createSearchDocumentsTool(options: SearchDocumentsToolOptions) {
  const { settings } = options;

  return {
    description: `Search through the user's documents, uploaded files, and past sessions.
      Use this when the user asks about their files, past conversations, or when you need
      specific information that might be in their documents.
      Temporary files are only available for the current turn.
      Return relevant excerpts with their source file names.`,
    inputSchema: z.object({
      query: z.string().describe("The search query"),
      search_mode: z.enum(["hybrid", "semantic", "keyword"]).default(settings.defaultSearchMode),
      scope: z.enum(["all", "uploads", "sessions", "external"]).default("all"),
    }),
    execute: async ({
      query,
      search_mode,
      scope,
    }: {
      query: string;
      search_mode: RagSearchMode;
      scope: RagSearchScope;
    }) => {
      // 1. Check cache
      const cacheKey = { query, mode: search_mode, scope };
      const cached = searchCache.get(cacheKey);
      if (cached) {
        return formatResults(cached.results);
      }

      // 2. Get all chunks
      const allChunks = await getAllChunks();
      if (allChunks.length === 0) {
        return "No documents are indexed yet. The user hasn't uploaded any files.";
      }

      // 3. Filter by scope
      const filteredChunks = allChunks;
      if (scope !== "all") {
        // In a full implementation, we'd filter by source
        // For now, search all
      }

      // 4. Search
      let results: SearchResult[];

      if (search_mode === "keyword") {
        // Keyword only
        const keywordResults = bm25Search(
          query,
          filteredChunks.map((c) => ({ id: c.id, text: c.text })),
          20,
        );
        results = keywordResults;
      } else if (search_mode === "semantic") {
        // Semantic only
        const model = EMBEDDING_MODELS.find((m) => m.id === settings.embeddingModelId)
          ?? EMBEDDING_MODELS[0];
        const embedder = await ensureEmbeddingModel(model);
        if (!embedder) {
          return "The local embedding model could not be loaded. Check your internet connection and try again.";
        }
        const queryEmbedding = await embedder.embed(query);
        const index = getVectorIndex(model.id, model.dimensions);
        const semanticResults = await index.search(queryEmbedding, 20);
        results = semanticResults.map((r: VectorSearchResult) => ({
          id: r.chunkId,
          score: r.score,
        }));
      } else {
        // Hybrid (default)
        const model = EMBEDDING_MODELS.find((m) => m.id === settings.embeddingModelId)
          ?? EMBEDDING_MODELS[0];
        const embedder = await ensureEmbeddingModel(model);
        if (!embedder) {
          return "The local embedding model could not be loaded. Check your internet connection and try again.";
        }
        const queryEmbedding = await embedder.embed(query);
        const index = getVectorIndex(model.id, model.dimensions);
        const semanticResults = await index.search(queryEmbedding, 20);
        const keywordResults = bm25Search(
          query,
          filteredChunks.map((c) => ({ id: c.id, text: c.text })),
          20,
        );
        results = hybridSearch(
          semanticResults.map((r: VectorSearchResult) => ({ id: r.chunkId, score: r.score })),
          keywordResults,
          settings.searchResultCount,
        );
      }

      // 5. Format results
      const formattedResults = results.map((r) => {
        const chunk = filteredChunks.find((c) => c.id === r.id);
        return {
          chunkId: r.id,
          text: chunk?.text ?? "",
          score: r.score,
          source: chunk?.metadata.source ?? "unknown",
          documentId: chunk?.documentId ?? "",
        };
      });

      // 6. Cache results
      searchCache.set(cacheKey, formattedResults);

      return formatResults(formattedResults);
    },
  };
}

/**
 * Format search results for the model.
 * Wraps chunks in delimiters to prevent prompt injection.
 */
function formatResults(results: Array<{
  chunkId: string;
  text: string;
  score: number;
  source: string;
  documentId: string;
}>): string {
  if (results.length === 0) {
    return "No relevant documents found.";
  }

  const parts: string[] = [];
  for (const [i, result] of results.entries()) {
    parts.push(
      `[BEGIN DOCUMENT: ${result.source}, result ${i + 1}]\n${result.text}\n[END DOCUMENT]`,
    );
  }
  return parts.join("\n\n");
}

/**
 * Clear the search cache (called when a new turn starts).
 */
export function clearSearchCache(): void {
  searchCache.clear();
}
