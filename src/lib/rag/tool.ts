/**
 * search_documents tool for the AI SDK.
 * 
 * Exposes RAG search to the model via a tool call.
 * The model can search documents, uploaded files, and past sessions.
 */

import { z } from "zod";
import type { RagModel, RagSearchMode, RagSearchScope, RagSettings, RagSource } from "@/types";
import { searchCache } from "./searchCache";
import { bm25Search } from "./keywordSearch";
import { hybridSearch, type SearchResult } from "./hybridSearch";
import { getVectorIndex, type VectorSearchResult } from "./vectorIndex";
import { getAllChunks, getDocuments } from "./documentManager";
import { currentEmbeddingVersion, isChunkStale } from "./embeddingVersion";
import { EMBEDDING_MODELS, OnnxEmbedder, isModelLoaded, loadEmbeddingModel } from "./embedder";

export interface SearchDocumentsToolOptions {
  settings: RagSettings;
}

/**
 * النطاق المطلوب → قيمة `RagDocument.source` التي يقابلها. `all` غائب عن
 * الخريطة عن قصد: لا ترشيح. المفتاح مُفهرس في rag_documents منذ المخطط v4.
 */
const SCOPE_TO_SOURCE: Record<Exclude<RagSearchScope, "all">, RagSource> = {
  uploads: "upload",
  sessions: "session",
  external: "external",
};

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
      await loadEmbeddingModel(model.id);
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
      scope: z
        .enum(["all", "uploads", "sessions", "external"])
        .default("all")
        .describe(
          "Which indexed sources to search: all, uploads (files the user uploaded), sessions (past conversations), or external (indexed folders).",
        ),
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
      // النموذج الفعّال يُحسم مرة واحدة: هو نفسه في الختم والبحث والفهرس.
      const model = EMBEDDING_MODELS.find((m) => m.id === settings.embeddingModelId)
        ?? EMBEDDING_MODELS[0];
      const activeVersion = currentEmbeddingVersion(model.id);

      // 1. Check cache — الهوية جزء من المفتاح: نتيجة بحث في فضاء سابق لا تصلح
      // لفضاء جديد.
      const cacheKey = { query, mode: search_mode, scope, version: activeVersion };
      const cached = searchCache.get(cacheKey);
      if (cached) {
        return formatResults(cached.results);
      }

      // 2. Get all chunks
      const allChunks = await getAllChunks();
      if (allChunks.length === 0) {
        return "No documents are indexed yet. The user hasn't uploaded any files.";
      }

      // 3. ترشيح النطاق بالوصل بـdocumentId (NM-05): `RagChunk` لا يحمل مصدر
      // مستنده، ونسخه داخلها كان سينحرف عند تغيّر المستند. القطع التي فقدت صفّ
      // مستندها تُستبعد في نطاق محدّد بدل أن تتسرّب إلى نتيجة نطاق آخر.
      let scopedChunks = allChunks;
      if (scope !== "all") {
        const documents = await getDocuments({ source: SCOPE_TO_SOURCE[scope] });
        const allowedDocuments = new Set(documents.map((document) => document.id));
        scopedChunks = allChunks.filter((chunk) => allowedDocuments.has(chunk.documentId));
      }

      // 3b. لا يُبحَث إلا في قطع الفضاء النشط: خلط فضاءَي متجهات يعطي نتائج بلا
      // معنى، والقطع بلا ختم قديمة بمُرمِّزها البديل فلا تُسرَّب إلى النتيجة.
      const searchableChunks = scopedChunks.filter(
        (chunk) => !isChunkStale(chunk, activeVersion),
      );
      // الفضاء النشط كله — لا النطاق — هو مصدر بناء الفهرس: الفهرس لا يُعاد بناؤه
      // ما دام حجمه غير صفر، فبناءٌ من نطاق واحد يُخفي بقية النطاقات عن كل بحث لاحق.
      const activeChunks = allChunks.filter((chunk) => !isChunkStale(chunk, activeVersion));
      if (searchableChunks.length === 0) {
        return "No relevant documents found.";
      }
      // فهرس المتجهات في الذاكرة يضم كل الفضاء النشط لا النطاق المطلوب، فتُرشَّح
      // نتائجه إلى القطع المسموح بها؛ بدون ذلك يعود النطاق بنتائج نطاق آخر.
      const searchableIds = new Set(searchableChunks.map((chunk) => chunk.id));

      // 4. Search
      let results: SearchResult[];

      if (search_mode === "keyword") {
        // Keyword only
        const keywordResults = bm25Search(
          query,
          searchableChunks.map((c) => ({ id: c.id, text: c.text })),
          20,
        );
        results = keywordResults;
      } else if (search_mode === "semantic") {
        // Semantic only
        const embedder = await ensureEmbeddingModel(model);
        if (!embedder) {
          return "The local embedding model could not be loaded. Check your internet connection and try again.";
        }
        const queryEmbedding = await embedder.embed(query);
        const index = getVectorIndex(model.id, model.dimensions, activeVersion);
        // الفهرس في الذاكرة يضيع مع كل تشغيل، ويُفرَّغ كاملًا إذا تغيّرت الهوية؛
        // إعادة البناء من القطع الحديثة تُصلح الحالتين معًا.
        if (index.size === 0) await index.buildFromChunks(activeChunks, activeVersion);
        const semanticResults = (await index.search(queryEmbedding, 20)).filter(
          (r: VectorSearchResult) => searchableIds.has(r.chunkId),
        );
        results = semanticResults.map((r: VectorSearchResult) => ({
          id: r.chunkId,
          score: r.score,
        }));
      } else {
        // Hybrid (default)
        const embedder = await ensureEmbeddingModel(model);
        if (!embedder) {
          return "The local embedding model could not be loaded. Check your internet connection and try again.";
        }
        const queryEmbedding = await embedder.embed(query);
        const index = getVectorIndex(model.id, model.dimensions, activeVersion);
        if (index.size === 0) await index.buildFromChunks(activeChunks, activeVersion);
        const semanticResults = (await index.search(queryEmbedding, 20)).filter(
          (r: VectorSearchResult) => searchableIds.has(r.chunkId),
        );
        const keywordResults = bm25Search(
          query,
          searchableChunks.map((c) => ({ id: c.id, text: c.text })),
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
        const chunk = searchableChunks.find((c) => c.id === r.id);
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
 * تعقيم المصدر المُقحَم في ترويسة الغلاف (NL-04): اسم ملف يحمل `]` أو سطرًا جديدًا
 * يستطيع إغلاق الغلاف وفتح ما يوهم النموذج بأنه خارج المستند. تُطوى المسافات وفواصل
 * الأسطر إلى مسافة واحدة وتُزال الأقواس المربعة، فيبقى الاسم مقروءًا ويبقى الغلاف محكمًا.
 */
function sanitizeSource(source: string): string {
  // \s يغطي كل فواصل الأسطر (\n \r \u2028 \u2029) وكل المسافات، فيُطوى السطر
  // إلى مسافة واحدة ولا يستطيع الاسم أن يفتح سطرًا في الترويسة.
  return source
    .replace(/\s+/g, " ")
    .replace(/[[\]]/g, "")
    .trim();
}

/**
 * تعقيم نصّ المستند من الرموز التي تُقلّد غلافنا: النصّ نفسه قد يحمل `[END DOCUMENT]`
 * فيُغلق الغلاف قبل موضعه ويصير ما بعده تعليمات. يُستبدل القوس المربع بقوس عادي فتبقى
 * الكلمات مقروءة للمستخدم، ويختفي الرمز الذي يعرفه النموذج.
 */
function neutraliseDelimiters(text: string): string {
  return text.replace(/\[(BEGIN|END) DOCUMENT(\])?/gi, "($1 DOCUMENT)");
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
    const header = `[BEGIN DOCUMENT: ${sanitizeSource(result.source)}, result ${i + 1}]`;
    parts.push(`${header}\n${neutraliseDelimiters(result.text)}\n[END DOCUMENT]`);
  }
  return parts.join("\n\n");
}

/**
 * Clear the search cache (called when a new turn starts).
 */
export function clearSearchCache(): void {
  searchCache.clear();
}
