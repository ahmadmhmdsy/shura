/**
 * HNSW vector index wrapper.
 * 
 * Uses hnswlib-wasm for approximate nearest neighbor search.
 * Scales from 2k to 1M+ vectors with O(log n) query time.
 * 
 * The index is built in-memory from Dexie-stored embeddings on startup,
 * and updated incrementally as new documents are indexed.
 */

import type { RagChunk } from "@/types";

type HnswlibModule = Awaited<ReturnType<typeof import("hnswlib-wasm")["loadHnswlib"]>>;
type HnswIndex = InstanceType<HnswlibModule["HierarchicalNSW"]>;

export interface VectorSearchResult {
  chunkId: string;
  score: number;  // cosine similarity (0-1)
}

/**
 * HNSW index wrapper.
 * 
 * Lazily initializes the WASM module on first use.
 * Supports incremental adds without rebuilding the entire index.
 */
export class VectorIndex {
  private index: HnswIndex | null = null;
  private hnswlib: HnswlibModule | null = null;
  private dimensions: number;
  private initialized = false;
  private chunkIds: string[] = [];  // maps index label → chunkId
  /** هوية فضاء المتجهات التي بُني منها الفهرس الحالي، أو null إن لم تُثبَّت. */
  private embeddingVersion: string | null = null;

  constructor(dimensions: number, embeddingVersion: string | null = null) {
    this.dimensions = dimensions;
    this.embeddingVersion = embeddingVersion;
  }

  /** هوية الفضاء الحالية. */
  get version(): string | null {
    return this.embeddingVersion;
  }

  /**
   * يثبّت هوية الفضاء، ويعيد true إذا تغيّرت.
   *
   * تغيّر الهوية يعني أن كل ما في الفهرس من فضاء آخر، فيُفرَّغ كاملًا بدل أن
   * يُبحَث فيه؛ وإعادة البناء مسؤولية المستدعي (من القطع الحديثة).
   */
  useEmbeddingVersion(embeddingVersion: string | null): boolean {
    if (this.embeddingVersion === embeddingVersion) return false;
    this.clear();
    this.embeddingVersion = embeddingVersion;
    return true;
  }

  /**
   * Initialize the HNSW index.
   * Must be called before any search or add operations.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    const { loadHnswlib } = await import("hnswlib-wasm");
    this.hnswlib = await loadHnswlib();
    
    this.index = new this.hnswlib!.HierarchicalNSW("cosine", this.dimensions, "");
    this.index.initIndex(1000, 16, 200, 100);
    this.initialized = true;
  }

  /**
   * Add a vector to the index.
   */
  async addVector(chunkId: string, vector: number[]): Promise<void> {
    if (!this.initialized) await this.initialize();
    const label = this.chunkIds.length;
    this.index!.addPoint(vector, label, false);
    this.chunkIds.push(chunkId);
  }

  /**
   * Add multiple vectors in batch.
   */
  async addVectors(items: Array<{ chunkId: string; vector: number[] }>): Promise<void> {
    if (!this.initialized) await this.initialize();
    for (const item of items) {
      await this.addVector(item.chunkId, item.vector);
    }
  }

  /**
   * Search for the k nearest neighbors of a query vector.
   */
  async search(query: number[], k: number = 20): Promise<VectorSearchResult[]> {
    if (!this.initialized) await this.initialize();
    if (!this.index) return [];

    const results = this.index.searchKnn(query, k, () => true);
    const neighbors = results.neighbors as number[];
    const distances = results.distances as number[];

    return neighbors.map((label, i) => ({
      chunkId: this.chunkIds[label],
      score: 1 - distances[i],  // convert distance to similarity
    }));
  }

  /**
   * Build the index from all stored chunks.
   * Called on app startup.
   */
  async buildFromChunks(
    chunks: RagChunk[],
    embeddingVersion: string | null = null,
  ): Promise<void> {
    if (!this.initialized) await this.initialize();
    this.embeddingVersion = embeddingVersion;
    
    // Reset and rebuild
    this.index = new this.hnswlib!.HierarchicalNSW("cosine", this.dimensions, "");
    this.index.initIndex(Math.max(1000, chunks.length * 2), 16, 200, 100);
    this.chunkIds = [];

    for (const chunk of chunks) {
      const label = this.chunkIds.length;
      this.index!.addPoint(chunk.embedding, label, false);
      this.chunkIds.push(chunk.id);
    }
  }

  /**
   * Get the number of vectors in the index.
   */
  get size(): number {
    return this.chunkIds.length;
  }

  /**
   * Clear the index.
   */
  clear(): void {
    this.index = null;
    this.chunkIds = [];
    this.initialized = false;
    this.embeddingVersion = null;
  }
}

// Global index instance — one per embedding model
const indexes = new Map<string, VectorIndex>();

/**
 * Get or create a vector index for a given embedding model.
 */
export function getVectorIndex(
  modelId: string,
  dimensions: number,
  embeddingVersion: string | null = null,
): VectorIndex {
  let index = indexes.get(modelId);
  if (!index) {
    index = new VectorIndex(dimensions, embeddingVersion);
    indexes.set(modelId, index);
  } else {
    index.useEmbeddingVersion(embeddingVersion);
  }
  return index;
}

/**
 * Clear all indexes (e.g., when switching models).
 */
export function clearAllIndexes(): void {
  for (const index of indexes.values()) {
    index.clear();
  }
  indexes.clear();
}
