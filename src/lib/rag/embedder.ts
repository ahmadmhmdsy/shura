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

import { getTransportFetch } from "@/lib/transport/transport";
import { getModelInfo, tokenizerAssetId } from "./modelCatalog";
import { assertWithinSize, verifyDigest, type AssetDigest } from "./verifiedDownload";
import {
  getModelBytes,
  getTokenizerAsset,
  putModelQuietly,
  putTokenizerAsset,
} from "./modelCache";
// الأصول التنفيذية تُحزم محليًا (T1.3، القرار D3، ADR 0004): كان المحرك يسحب ملف
// wasm من CDN فينفّذ كودًا من أصل بعيد - وهو ما رفضه script-src 'self' أصلًا.
// استيراد ?url يعطي مسار الملف المُصدَر بلا تحميل وحدة المحرك، وكائن { wasm, mjs }
// هو ما يدعمه onnxruntime-web فعليًا في env.wasm.wasmPaths.
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import ortWasmMjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";

// يُعاد التصدير من هنا لأن الوحدات الأخرى (documentManager وsessionIndexer وtool
// وreindexManager وRagSettings) تستورد الكتالوج من هذا الموضع تاريخيًا.
export { EMBEDDING_MODELS, getModelInfo, getModelUrl } from "./modelCatalog";

type OrtModule = typeof import("onnxruntime-web/wasm");
type OrtSession = Awaited<ReturnType<OrtModule["InferenceSession"]["create"]>>;

export interface Embedder {
  readonly modelId: string;
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

/** Default embedding model, used when no model is specified. */
const DEFAULT_MODEL_ID = "multilingual-e5-small";

/** A fully loaded embedding model: ONNX inference session + tokenizer. */
export interface LoadedEmbeddingModel {
  modelId: string;
  session: OrtSession;
  tokenizer: TextTokenizer;
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
): Promise<LoadedEmbeddingModel> {
  if (cachedModel?.modelId === modelId) {
    return cachedModel;
  }
  if (modelLoadPromise) {
    return modelLoadPromise;
  }

  modelLoadPromise = doLoadModel(modelId);
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
async function doLoadModel(modelId: string): Promise<LoadedEmbeddingModel> {
  // Dynamic import to avoid loading ONNX Runtime until needed. الوجهة ./wasm هي
  // بناء مسار wasm وحده: البناء الافتراضي (ort.bundle) يحمل JSEP ويسحب
  // ort-wasm-simd-threaded.jsep.wasm بحجم 28.3 م.ب، والتطبيق لا يستعمل WebGPU،
  // فبناء wasm وحده يكفي ويوفّر 14.1 م.ب من كل نسخة ومن ذاكرة التشغيل.
  const ort = await import("onnxruntime-web/wasm");

  // مسار أصول المحرك محلي: لا كود قابل للتنفيذ يُسحب من الشبكة.
  ort.env.wasm.wasmPaths = { wasm: ortWasmUrl, mjs: ortWasmMjsUrl };

  // Load model from IndexedDB or download
  const modelData = await getModelBytes(modelId);
  let session: OrtSession;
  if (modelData) {
    session = await ort.InferenceSession.create(modelData);
  } else {
    // Download model and cache it
    const info = getModelInfo(modelId);
    if (!info) throw new Error(`Unknown embedding model: ` + modelId);
    // التنزيل عبر النقل الموحّد: plugin-http تحت Tauri (يحكمه سماح http:default
    // فلا حاجة لفتح connect-src)، وfetch العادي في الويب.
    const response = await getTransportFetch()(info.url);
    if (!response.ok) {
      throw new Error(`Model download failed: ${response.status} ${response.statusText}`);
    }
    const modelBytes = await readVerified(response, info.integrity.model);
    // الكتابة عبر كاتب الكاش الوحيد (T1.6)، وفشلها غير قاتل: البايتات تمرّ إلى
    // المحرك في الذاكرة، فإفشال تحميل نجح لأن الكاش لم يُكتب خسارة بلا مقابل.
    await putModelQuietly(modelId, modelBytes);
    session = await ort.InferenceSession.create(modelBytes);
  }

  // Initialize tokenizer
  const tokenizer = await loadTokenizer(modelId);
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
  private loaded: { session: OrtSession; tokenizer: TextTokenizer } | null = null;

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
  private async ensureLoaded(): Promise<{ session: OrtSession; tokenizer: TextTokenizer }> {
    if (this.loaded) return this.loaded;
    const { session, tokenizer } = await loadEmbeddingModel(this.modelId);
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

    const ort = await import("onnxruntime-web/wasm");
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
    tokenizer: TextTokenizer,
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

/** أقصى عدد معرّفات يُمرَّر إلى النموذج، ويشمل رمزَي البداية والنهاية. */
const MAX_TOKEN_LENGTH = 512;

/**
 * واجهة المُرمِّز التي يحتاجها المضمّن وحده: نص إلى معرّفات.
 *
 * لا يتسرّب نوع مكتبة الترميز إلى بقية التطبيق، فيبقى استبدالها لاحقًا محصورًا هنا.
 */
export interface TextTokenizer {
  encode(text: string, maxLength?: number): number[];
}

// نسخة واحدة لكل نموذج، محفوظة كوعد حتى يشارك المتصلون المتزامنون التحميل نفسه.
// ويُحذف الوعد عند الفشل، فلا يعلق فشل عابر في الذاكرة وتمكن إعادة المحاولة.
const tokenizerCache = new Map<string, Promise<TextTokenizer>>();

/**
 * تحميل مُرمِّز النموذج من ملفَّيه عبر كاش النماذج، وإعادة نسخة واحدة لكل معرّف.
 *
 * نموذج غير معروف يرمي خطأً، ولا يوجد مُرمِّز بديل صامت: المُرمِّز هو ما يحدّد فضاء
 * المتجهات، وتقسيم المسافات يعطي معرّفات لا معنى لها تتغيّر بتغيّر ترتيب الكلمات،
 * فتصبح تضمينات الجلسات السابقة غير قابلة للمقارنة بعد إعادة التشغيل (NH-01).
 */
export async function loadTokenizer(modelId: string): Promise<TextTokenizer> {
  const cached = tokenizerCache.get(modelId);
  if (cached) return cached;

  const loading = doLoadTokenizer(modelId).catch((error: unknown) => {
    tokenizerCache.delete(modelId);
    throw error;
  });
  tokenizerCache.set(modelId, loading);
  return loading;
}

async function doLoadTokenizer(modelId: string): Promise<TextTokenizer> {
  const info = getModelInfo(modelId);
  if (!info) throw new Error(`Unknown embedding model: ` + modelId);

  // الملفان معًا: `tokenizer.json` يحمل المفردات، و`tokenizer_config.json` يحمل
  // الإعدادات التي تبني عليها المكتبة المُرمِّز (منها مقبض التقطيع المسبق).
  const [tokenizerJson, tokenizerConfig] = await Promise.all([
    loadTokenizerAsset(info.tokenizerUrl, tokenizerAssetId(modelId, "tokenizer.json"), info.integrity.tokenizer),
    loadTokenizerAsset(
      info.tokenizerConfigUrl,
      tokenizerAssetId(modelId, "tokenizer_config.json"),
      info.integrity.tokenizerConfig,
    ),
  ]);

  const { Tokenizer } = await import("@huggingface/tokenizers");
  const tokenizer = new Tokenizer(tokenizerJson, tokenizerConfig);

  return {
    encode: (text: string, maxLength: number = MAX_TOKEN_LENGTH) => {
      // الرموز الخاصة تأتي من المُعالج اللاحق المُعرَّف في الملف نفسه، لا من
      // قائمة مكتوبة هنا: <s></s> لـ XLM-R و[CLS][SEP] لـ BERT.
      const { ids } = tokenizer.encode(text, { add_special_tokens: true });
      if (ids.length <= maxLength) return ids;
      // الاقتطاع يحفظ الطرفين: رمز البداية ورمز النهاية، فالاقتطاع الأعمى كان
      // يحذف رمز النهاية فينتج تضمين لم يُغلق تسلسله.
      return [ids[0], ...ids.slice(1, maxLength - 1), ids[ids.length - 1]];
    },
  };
}

/** تنزيل أصل مرة واحدة وتخزينه في كاش النماذج، ثم إعادته ككائن JSON. */
async function loadTokenizerAsset(url: string, assetId: string, expected: AssetDigest): Promise<object> {
  const cached = await getTokenizerAsset(assetId);
  const bytes = cached ?? (await downloadAsset(url, assetId, expected));
  return JSON.parse(new TextDecoder().decode(bytes)) as object;
}

async function downloadAsset(url: string, assetId: string, expected: AssetDigest): Promise<ArrayBuffer> {
  const response = await getTransportFetch()(url);
  if (!response.ok) {
    throw new Error(`Tokenizer download failed: ` + response.status + " " + response.statusText);
  }
  const bytes = await readVerified(response, expected);
  await putTokenizerAsset(assetId, bytes);
  return bytes;
}

/** Reads a pinned asset, refusing an oversized response and bytes that fail the digest. */
async function readVerified(response: Response, expected: AssetDigest): Promise<ArrayBuffer> {
  assertWithinSize(Number(response.headers?.get("content-length") ?? 0), expected);
  const bytes = await response.arrayBuffer();
  await verifyDigest(bytes, expected);
  return bytes;
}

// كتالوج النماذج انتقل إلى "./modelCatalog" ويُعاد تصديره في أعلى الملف.
