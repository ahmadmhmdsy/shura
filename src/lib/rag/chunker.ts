/**
 * Text chunking for RAG indexing.
 * Splits text into overlapping chunks of configurable size.
 * Preserves structure by splitting on paragraphs first, then sentences, then words.
 */

import { estimateTokens } from "@/lib/tokens/estimate";

export interface ChunkingOptions {
  chunkSize: number;    // max tokens per chunk
  overlap: number;      // tokens of overlap between chunks
}

export interface ChunkResult {
  text: string;
  startIndex: number;
  endIndex: number;
}

/**
 * Split text into sentences (rough approximation).
 */
function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by space or end
  return text
    .split(/(?<=[.!?؟。！？])\s+/)
    .filter((s) => s.trim().length > 0);
}

/**
 * Split text into words.
 */
function splitWords(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

/**
 * Chunk text into overlapping pieces.
 * Strategy:
 * 1. Split by paragraphs (double newlines)
 * 2. For each paragraph, if it fits in chunkSize, keep it whole
 * 3. If too large, split by sentences
 * 4. If a sentence is still too large, split by words with overlap
 */
export function chunkText(
  text: string,
  options: ChunkingOptions,
): ChunkResult[] {
  const { chunkSize, overlap } = options;
  const results: ChunkResult[] = [];
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);

  for (const paragraph of paragraphs) {
    const paraTokens = estimateTokens(paragraph);
    if (paraTokens <= chunkSize) {
      // Paragraph fits — add as a single chunk
      results.push({
        text: paragraph.trim(),
        startIndex: 0,
        endIndex: paragraph.length,
      });
    } else {
      // Paragraph too large — split by sentences
      const sentences = splitSentences(paragraph);
      let currentChunk = "";
      let currentTokens = 0;

      for (const sentence of sentences) {
        const sentTokens = estimateTokens(sentence);
        if (sentTokens > chunkSize) {
          // Sentence too large — flush current chunk, then split by words
          if (currentChunk) {
            results.push({ text: currentChunk.trim(), startIndex: 0, endIndex: currentChunk.length });
            currentChunk = "";
            currentTokens = 0;
          }
          // Split sentence by words with overlap
          const words = splitWords(sentence);
          let wordChunk = "";
          let wordTokens = 0;
          for (const word of words) {
            const wordTokenCount = estimateTokens(word);
            if (wordTokens + wordTokenCount > chunkSize && wordChunk) {
              results.push({ text: wordChunk.trim(), startIndex: 0, endIndex: wordChunk.length });
              // Keep overlap words for next chunk
              // overlap === 0 means "no overlap": guard it explicitly because
              // Math.ceil(0 / 4) === 0 and slice(-0) === slice(0), which would copy the
              // whole previous chunk and blow past chunkSize on the next one.
              const overlapWords = overlap > 0 ? splitWords(wordChunk).slice(-Math.ceil(overlap / 4)) : [];
              wordChunk = overlapWords.length > 0 ? overlapWords.join(" ") + " " + word : word;
              wordTokens = estimateTokens(wordChunk);
            } else {
              wordChunk = wordChunk ? wordChunk + " " + word : word;
              wordTokens += wordTokenCount;
            }
          }
          if (wordChunk) {
            results.push({ text: wordChunk.trim(), startIndex: 0, endIndex: wordChunk.length });
          }
        } else if (currentTokens + sentTokens > chunkSize) {
          // Adding this sentence would exceed chunkSize — flush and start new
          if (currentChunk) {
            results.push({ text: currentChunk.trim(), startIndex: 0, endIndex: currentChunk.length });
          }
          // Keep overlap from previous chunk
          // Same slice(-0) hazard as the word path above.
          const overlapSentences = overlap > 0 ? splitSentences(currentChunk).slice(-Math.ceil(overlap / 100)) : [];
          currentChunk = overlapSentences.length > 0 ? overlapSentences.join(" ") + " " + sentence : sentence;
          currentTokens = estimateTokens(currentChunk);
        } else {
          // Sentence fits — add to current chunk
          currentChunk = currentChunk ? currentChunk + " " + sentence : sentence;
          currentTokens += sentTokens;
        }
      }
      if (currentChunk) {
        results.push({ text: currentChunk.trim(), startIndex: 0, endIndex: currentChunk.length });
      }
    }
  }

  return results;
}

/**
 * Preset chunking configurations.
 */
export const CHUNKING_PRESETS = {
  balanced: { chunkSize: 500, overlap: 100 },
  precise: { chunkSize: 300, overlap: 50 },
  contextual: { chunkSize: 800, overlap: 150 },
} as const;
