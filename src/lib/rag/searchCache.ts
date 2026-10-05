/**
 * Per-turn search result cache.
 * Prevents redundant embedding + search when multiple models
 * in the same turn search for the same query.
 */

import type { RagSearchMode, RagSearchScope } from "@/types";

export interface CacheKey {
  query: string;
  mode: RagSearchMode;
  scope: RagSearchScope;
}

export interface CacheEntry {
  results: Array<{
    chunkId: string;
    text: string;
    score: number;
    source: string;
    documentId: string;
  }>;
  timestamp: number;
}

/**
 * Simple in-memory cache for search results within a turn.
 * Cleared when a new turn starts.
 */
export class SearchCache {
  private cache = new Map<string, CacheEntry>();
  private maxAgeMs = 5 * 60 * 1000; // 5 minutes

  private keyOf(key: CacheKey): string {
    return `${key.query}::${key.mode}::${key.scope}`;
  }

  get(key: CacheKey): CacheEntry | undefined {
    const entry = this.cache.get(this.keyOf(key));
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > this.maxAgeMs) {
      this.cache.delete(this.keyOf(key));
      return undefined;
    }
    return entry;
  }

  set(key: CacheKey, results: CacheEntry["results"]): void {
    this.cache.set(this.keyOf(key), {
      results,
      timestamp: Date.now(),
    });
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// Global cache instance — one per turn
export const searchCache = new SearchCache();
