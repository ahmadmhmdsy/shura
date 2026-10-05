/**
 * BM25 keyword search implementation.
 * No external dependencies — pure TypeScript.
 * Scores chunks based on term frequency and inverse document frequency.
 */

export interface KeywordSearchResult {
  id: string;
  score: number;
}

/**
 * Tokenize text into lowercase terms.
 * Handles Arabic and Latin text.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

/**
 * Compute BM25 scores for a query against a set of documents.
 *
 * BM25 formula:
 *   score(D, Q) = Σ IDF(qi) * (f(qi, D) * (k1 + 1)) / (f(qi, D) + k1 * (1 - b + b * |D| / avgdl))
 *
 * where:
 *   IDF(qi) = ln((N - n(qi) + 0.5) / (n(qi) + 0.5) + 1)
 *   f(qi, D) = term frequency of qi in document D
 *   |D| = document length
 *   avgdl = average document length
 *   N = total number of documents
 *   n(qi) = number of documents containing qi
 *   k1 = 1.2 (term frequency saturation)
 *   b = 0.75 (length normalization)
 */
export function bm25Search(
  query: string,
  documents: Array<{ id: string; text: string }>,
  k: number = 20,
): KeywordSearchResult[] {
  if (documents.length === 0) return [];

  const k1 = 1.2;
  const b = 0.75;
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  // Compute document frequencies
  const docFreqs = new Map<string, number>();
  const docLengths: number[] = [];
  const termFreqs: Array<Map<string, number>> = [];

  for (const doc of documents) {
    const terms = tokenize(doc.text);
    docLengths.push(terms.length);
    const tf = new Map<string, number>();
    for (const term of terms) {
      tf.set(term, (tf.get(term) ?? 0) + 1);
    }
    termFreqs.push(tf);
    for (const term of new Set(terms)) {
      docFreqs.set(term, (docFreqs.get(term) ?? 0) + 1);
    }
  }

  const avgdl = docLengths.reduce((a, c) => a + c, 0) / docLengths.length;
  const N = documents.length;

  // Compute IDF for each query term
  const idf = new Map<string, number>();
  for (const term of queryTerms) {
    const n = docFreqs.get(term) ?? 0;
    idf.set(term, Math.log((N - n + 0.5) / (n + 0.5) + 1));
  }

  // Score each document
  const scores: KeywordSearchResult[] = [];
  for (let i = 0; i < documents.length; i++) {
    let score = 0;
    const tf = termFreqs[i];
    const docLen = docLengths[i];
    for (const term of queryTerms) {
      const f = tf.get(term) ?? 0;
      if (f === 0) continue;
      const idfVal = idf.get(term) ?? 0;
      const numerator = f * (k1 + 1);
      const denominator = f + k1 * (1 - b + (b * docLen) / avgdl);
      score += idfVal * (numerator / denominator);
    }
    if (score > 0) {
      scores.push({ id: documents[i].id, score });
    }
  }

  // Sort by score descending and return top-k
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, k);
}
