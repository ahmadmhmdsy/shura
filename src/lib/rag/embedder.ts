/**
 * Embedder interface and ONNX Runtime implementation.
 * 
 * The Embedder abstraction makes it easy to swap between:
 * - Local ONNX models (default)
 * - API-based embeddings (future hybrid mode)
 * 
 * All embeddings for a given model are compatible with each other.
 * Switching models requires re-indexing all documents.
 * 
 * The ONNX model is loaded lazily on first RAG use (not on startup) and the
 * loaded session is cached at module level, so the search tool, the document
 * indexer, and the session indexer all share one model instance.
 */

import { db } from "@/lib/db/db";
import { getModelUrl } from "./modelCatalog";

// يُعاد التصدير من هنا لأن الوحدات الأخرى (documentManager وsessionIndexer وtool
// وreindexManager وRagSettings) تستورد الكتالوج من هذا الموضع تاريخيًا.
export { EMBEDDING_MODELS, getModelInfo, getModelUrl } from "./modelCatalog";

type OrtModule = typeof import("onnxruntime-web");
type OrtSession = Awaited<ReturnType<OrtModule["InferenceSession"]["create"]>>;

export interface Embedder {
  readonly modelId: string;
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

/** Default embedding model, used when no model is specified. */
const DEFAULT_MODEL_ID = "multilingual-e5-small";
const DEFAULT_MODEL_DIMENSIONS = 384;

/** A fully loaded embedding model: ONNX inference session + tokenizer. */
export interface LoadedEmbeddingModel {
  modelId: string;
  session: OrtSession;
  tokenizer: Tokenizer;
}

// Module-level cache: the model is loaded once per process and shared by every
// OnnxEmbedder instance. modelLoadPromise deduplicates concurrent loads.
let cachedModel: LoadedEmbeddingModel | null = null;
let modelLoadPromise: Promise<LoadedEmbeddingModel> | null = null;
let modelLoadError: Error | null = null;

/**
 * Load the ONNX embedding model lazily and cache it at module level.
 * 
 * Safe to call from multiple places: concurrent callers share one in-flight
 * load, and a failed load can be retried on the next call.
 */
export async function loadEmbeddingModel(
  modelId: string = DEFAULT_MODEL_ID,
  dimensions: number = DEFAULT_MODEL_DIMENSIONS,
): Promise<LoadedEmbeddingModel> {
  if (cachedModel?.modelId === modelId) {
    return cachedModel;
  }
  if (modelLoadPromise) {
    return modelLoadPromise;
  }

  modelLoadPromise = doLoadModel(modelId, dimensions);
  try {
    const loaded = await modelLoadPromise;
    cachedModel = loaded;
    modelLoadError = null;
    return loaded;
  } catch (error) {
    modelLoadError = error instanceof Error ? error : new Error(String(error));
    throw modelLoadError;
  } finally {
    modelLoadPromise = null;
  }
}

/**
 * Whether the embedding model has finished loading successfully.
 */
export function isModelLoaded(): boolean {
  return cachedModel !== null;
}

/**
 * The error from the last failed model load, or null if the last load
 * succeeded (or no load was ever attempted).
 */
export function getModelLoadError(): Error | null {
  return modelLoadError;
}

/**
 * Perform the actual load: dynamic ONNX Runtime import, IndexedDB cache
 * lookup, download on a cache miss, and tokenizer initialization.
 */
async function doLoadModel(
  modelId: string,
  dimensions: number,
): Promise<LoadedEmbeddingModel> {
  // Dynamic import to avoid loading ONNX Runtime until needed
  const ort = await import("onnxruntime-web");

  // Set WASM paths (CDN for web, local for Tauri)
  ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";

  // Load model from IndexedDB or download
  const modelData = await loadModelFromCache(modelId);
  let session: OrtSession;
  if (modelData) {
    session = await ort.InferenceSession.create(modelData);
  } else {
    // Download model and cache it
    const modelUrl = getModelUrl(modelId);
    const response = await fetch(modelUrl);
    if (!response.ok) {
      throw new Error(`Model download failed: ${response.status} ${response.statusText}`);
    }
    const modelBytes = await response.arrayBuffer();
    await saveModelToCache(modelId, dimensions, modelBytes);
    session = await ort.InferenceSession.create(modelBytes);
  }

  // Initialize tokenizer
  const tokenizer = await loadTokenizer();
  return { modelId, session, tokenizer };
}

/**
 * ONNX Runtime Web embedder for local embedding inference.
 * 
 * Uses WASM-based ONNX Runtime that works in both browser and Tauri webview.
 * Models are downloaded once and cached in IndexedDB.
 */
export class OnnxEmbedder implements Embedder {
  // الجلسة والمُرمِّز يُضبطان معًا ولا يُفكّان أبدًا، فحقل واحد يغني عن فحصين
  // منفصلين لـ null وعن تأكيدات non-null في كل موضع استخدام.
  private loaded: { session: OrtSession; tokenizer: Tokenizer } | null = null;

  constructor(
    public readonly modelId: string,
    public readonly dimensions: number,
  ) {}

  /**
   * Initialize the embedder: load model and tokenizer.
   * Model is cached in IndexedDB after first download and shared across all
   * embedder instances through the module-level cache.
   */
  async initialize(): Promise<void> {
    await this.ensureLoaded();
  }

  /** تحميل واحد مشترك: يعيد المحمَّل إن وُجد، وإلا يحمّله مرة واحدة. */
  private async ensureLoaded(): Promise<{ session: OrtSession; tokenizer: Tokenizer }> {
    if (this.loaded) return this.loaded;
    const { session, tokenizer } = await loadEmbeddingModel(this.modelId, this.dimensions);
    this.loaded = { session, tokenizer };
    return this.loaded;
  }

  /**
   * Embed a single text string.
   */
  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  /**
   * Embed multiple texts in batch (more efficient).
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    const { session, tokenizer } = await this.ensureLoaded();

    const ort = await import("onnxruntime-web");
    const embeddings: number[][] = [];

    // Process in batches of 32 for efficiency
    const batchSize = 32;
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchEmbeddings = await this.embedBatchInternal(ort, session, tokenizer, batch);
      embeddings.push(...batchEmbeddings);
    }

    return embeddings;
  }

  private async embedBatchInternal(
    ort: OrtModule,
    session: OrtSession,
    tokenizer: Tokenizer,
    texts: string[],
  ): Promise<number[][]> {
    // Tokenize
    const tokenized = texts.map((t) => tokenizer.encode(t));
    
    // Create input tensors
    const maxLen = Math.max(...tokenized.map((t) => t.length));
    const inputIds = new BigInt64Array(texts.length * maxLen);
    const attentionMask = new BigInt64Array(texts.length * maxLen);
    
    for (let i = 0; i < texts.length; i++) {
      const tokens = tokenized[i];
      for (let j = 0; j < maxLen; j++) {
        inputIds[i * maxLen + j] = j < tokens.length ? BigInt(tokens[j]) : 0n;
        attentionMask[i * maxLen + j] = j < tokens.length ? 1n : 0n;
      }
    }

    const inputTensor = new ort.Tensor("int64", inputIds, [texts.length, maxLen]);
    const maskTensor = new ort.Tensor("int64", attentionMask, [texts.length, maxLen]);

    // Run inference
    const results = await session.run({
      input_ids: inputTensor,
      attention_mask: maskTensor,
    });

    // Extract embeddings (mean pooling)
    const embeddings = results["last_hidden_state"];
    const [batchSize, seqLen, hiddenSize] = embeddings.dims;
    const data = embeddings.data as Float32Array;
    
    const output: number[][] = [];
    for (let b = 0; b < batchSize; b++) {
      const embedding = new Array(this.dimensions).fill(0);
      let count = 0;
      for (let s = 0; s < seqLen; s++) {
        const mask = Number(attentionMask[b * maxLen + s]);
        if (mask === 0) continue;
        for (let h = 0; h < hiddenSize; h++) {
          embedding[h] += data[b * seqLen * hiddenSize + s * hiddenSize + h];
        }
        count++;
      }
      // Mean pooling
      for (let h = 0; h < this.dimensions; h++) {
        embedding[h] = count > 0 ? embedding[h] / count : 0;
      }
      // L2 normalize
      const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
      if (norm > 0) {
        for (let h = 0; h < this.dimensions; h++) {
          embedding[h] /= norm;
        }
      }
      output.push(embedding);
    }
    
    return output;
  }
}

/**
 * Try to read the model bytes from IndexedDB.
 * Returns null when the model was never downloaded.
 *
 * البايتات في جدول rag_model_blobs منفصلة عن الصف الوصفي في rag_models، فقراءة
 * «هل النموذج منزَّل؟» لا تسحب مئات الميغابايتات.
 */
async function loadModelFromCache(modelId: string): Promise<ArrayBuffer | null> {
  try {
    const cached = await db.rag_model_blobs.get(modelId);
    return cached?.bytes ?? null;
  } catch {
    return null;
  }
}

/**
 * Record a successful model download in IndexedDB: metadata in rag_models and the
 * bytes in rag_model_blobs. A cache write failure is non-fatal.
 */
async function saveModelToCache(
  modelId: string,
  dimensions: number,
  modelBytes: ArrayBuffer,
): Promise<void> {
  try {
    await db.transaction("rw", [db.rag_models, db.rag_model_blobs], async () => {
      await db.rag_models.put({
        id: modelId,
        modelId: modelId,
        label: modelId,
        dimensions: dimensions,
        downloadedAt: Date.now(),
        sizeBytes: modelBytes.byteLength,
      });
      await db.rag_model_blobs.put({ id: modelId, bytes: modelBytes });
    });
  } catch {
    // Cache failure is non-fatal
  }
}

/**
 * Load the tokenizer for the model.
 */
async function loadTokenizer(): Promise<Tokenizer> {
  // For MVP, use a simple whitespace tokenizer
  // In production, use a proper SentencePiece/BPE tokenizer
  return new SimpleTokenizer();
}

/**
 * Simple whitespace tokenizer for MVP.
 * Can be replaced with a proper SentencePiece tokenizer later.
 */
class SimpleTokenizer {
  private vocab = new Map<string, number>();
  private nextId = 1;

  constructor() {
    // Special tokens
    this.vocab.set("<pad>", 0);
    this.vocab.set("<unk>", 1);
    this.vocab.set("<cls>", 2);
    this.vocab.set("<sep>", 3);
  }

  encode(text: string, maxLength = 512): number[] {
    const tokens = text.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
    const ids = [2]; // <cls>
    for (const token of tokens.slice(0, maxLength - 2)) {
      let id = this.vocab.get(token);
      if (id === undefined) {
        id = this.nextId++;
        this.vocab.set(token, id);
      }
      ids.push(id);
    }
    ids.push(3); // <sep>
    return ids;
  }
}

interface Tokenizer {
  encode(text: string, maxLength?: number): number[];
}

// كتالوج النماذج انتقل إلى "./modelCatalog" ويُعاد تصديره في أعلى الملف.
