/**
 * Embedding model downloader.
 * 
 * Handles downloading ONNX embedding models from HuggingFace
 * and caching them in IndexedDB for offline use.
 */

import { getTransportFetch } from "@/lib/transport/transport";
import { getModelInfo } from "./modelCatalog";
import { deleteModel as deleteCachedModel, getModel, listModels, putModel } from "./modelCache";
import type { RagModel } from "@/types";

export interface DownloadProgress {
  loaded: number;
  total: number;
  percent: number;
}

/**
 * Download an embedding model and cache it.
 * 
 * @param modelId The model ID (e.g., "multilingual-e5-small")
 * @param onProgress Optional progress callback
 */
/**
 * قارئ موحّد للاستجابة: الويب يبثّ الجسم (body) فيرى المستخدم النسبة تتقدّم،
 * أما plugin-http في Tauri فيسلّم البايتات كاملة بلا ReadableStream، فنغلّفها
 * هنا في قطعة واحدة بدل الفشل بـ«No response body» على سطح المكتب.
 */
async function toReader(response: Response): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  if (typeof response.arrayBuffer !== "function") throw new Error("No response body");
  const bytes = new Uint8Array(await response.arrayBuffer());
  let served = false;
  return {
    read: async () =>
      served ? { done: true, value: undefined } : ((served = true), { done: false, value: bytes }),
  } as ReadableStreamDefaultReader<Uint8Array>;
}

export async function downloadModel(
  modelId: string,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<void> {
  const model = getModelInfo(modelId);
  if (!model) throw new Error(`Unknown model: ${modelId}`);

  const response = await getTransportFetch()(model.url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0);
  const reader = response.body?.getReader() ?? (await toReader(response));

  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    chunks.push(value);
    loaded += value.length;
    
    if (onProgress && contentLength > 0) {
      onProgress({
        loaded,
        total: contentLength,
        percent: Math.round((loaded / contentLength) * 100),
      });
    }
  }

  // Combine chunks
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const modelBytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    modelBytes.set(chunk, offset);
    offset += chunk.length;
  }

  // الكتابة عبر كاتب الكاش الوحيد (T1.6): صف وصفي خفيف وبايتات في جدول منفصل،
  // وإلا صار كل استعلام «هل النموذج منزَّل؟» يسحب مئات الميغابايتات.
  // modelBytes أُسند إليه صفًا بصف أعلاه، فمخزنه الخلفي بطول النموذج بالضبط.
  await putModel(modelId, modelBytes.buffer as ArrayBuffer);
}

/**
 * Check if a model is already downloaded.
 */
export async function isModelDownloaded(modelId: string): Promise<boolean> {
  return (await getModel(modelId)) !== undefined;
}

/**
 * Get download progress for a model.
 */
export async function getModelDownloadStatus(modelId: string): Promise<{
  downloaded: boolean;
  sizeBytes: number;
  downloadedAt: number | null;
}> {
  const model = await getModel(modelId);
  return {
    downloaded: model !== undefined,
    sizeBytes: model?.sizeBytes ?? 0,
    downloadedAt: model?.downloadedAt ?? null,
  };
}

/**
 * Delete a downloaded model.
 */
export async function deleteModel(modelId: string): Promise<void> {
  await deleteCachedModel(modelId);
}

/**
 * Get all downloaded models.
 */
export async function getDownloadedModels(): Promise<RagModel[]> {
  return listModels();
}

// getModelInfo وgetModelUrl انتقلا إلى "./modelCatalog": كان الكتالوج هنا نسخة
// رابعة مكرّرة، وخريطة الروابط هنا خامسة، وكلتاهما عرضة للانحراف عن الأصل.
