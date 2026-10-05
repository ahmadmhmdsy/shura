/**
 * Hybrid search: combines semantic (vector) and keyword (BM25) results
 * using Reciprocal Rank Fusion (RRF).
 *
 * RRF formula: score(d) = Σ 1/(k + rank_i(d))
 * where k = 60 (standard constant), rank_i(d) is the document's rank in list i
 *
 * Inspired by CocoIndex's hybrid search approach.
 */

export interface SearchResult {
  id: string;
  score: number;
}

/**
 * Reciprocal Rank Fusion.
 * Merges multiple ranked lists into one.
 * Uses rank positions (not scores) — distribution-agnostic.
 */
export function rrfFusion(
  resultLists: SearchResult[][],
  k: number = 60,
): SearchResult[] {
  const scores = new Map<string, number>();

  for (const results of resultLists) {
    for (const [rank, result] of results.entries()) {
      const rrfScore = 1 / (k + rank + 1);
      scores.set(result.id, (scores.get(result.id) ?? 0) + rrfScore);
    }
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Hybrid search orchestrator.
 * Takes semantic and keyword results, fuses them, returns top-k.
 */
export function hybridSearch(
  semanticResults: SearchResult[],
  keywordResults: SearchResult[],
  topK: number = 10,
): SearchResult[] {
  const fused = rrfFusion([semanticResults, keywordResults]);
  return fused.slice(0, topK);
}
