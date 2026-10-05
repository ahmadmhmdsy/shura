/**
 * Embedding model downloader.
 * 
 * Handles downloading ONNX embedding models from HuggingFace
 * and caching them in IndexedDB for offline use.
 */

import { db } from "@/lib/db/db";
import { getModelInfo } from "./modelCatalog";
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
export async function downloadModel(
  modelId: string,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<void> {
  const model = getModelInfo(modelId);
  if (!model) throw new Error(`Unknown model: ${modelId}`);

  const response = await fetch(model.url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

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

  // Cache in IndexedDB: صف وصفي خفيف + البايتات في جدول منفصل، وإلا صار كل
  // استعلام «هل النموذج منزَّل؟» يسحب مئات الميغابايتات.
  await db.transaction("rw", [db.rag_models, db.rag_model_blobs], async () => {
    await db.rag_models.put({
      id: modelId,
      modelId,
      label: model.label,
      dimensions: model.dimensions,
      downloadedAt: Date.now(),
      sizeBytes: totalLength,
    });
    // modelBytes أُسند إليه صفًا بصف أعلاه، فمخزنه الخلفي بطول النموذج بالضبط.
    await db.rag_model_blobs.put({ id: modelId, bytes: modelBytes.buffer as ArrayBuffer });
  });
}

/**
 * Check if a model is already downloaded.
 */
export async function isModelDownloaded(modelId: string): Promise<boolean> {
  const model = await db.rag_models.get(modelId);
  return model !== undefined;
}

/**
 * Get download progress for a model.
 */
export async function getModelDownloadStatus(modelId: string): Promise<{
  downloaded: boolean;
  sizeBytes: number;
  downloadedAt: number | null;
}> {
  const model = await db.rag_models.get(modelId);
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
  await db.transaction("rw", [db.rag_models, db.rag_model_blobs], async () => {
    await db.rag_models.delete(modelId);
    await db.rag_model_blobs.delete(modelId);
  });
}

/**
 * Get all downloaded models.
 */
export async function getDownloadedModels(): Promise<RagModel[]> {
  return db.rag_models.toArray();
}

// getModelInfo وgetModelUrl انتقلا إلى "./modelCatalog": كان الكتالوج هنا نسخة
// رابعة مكرّرة، وخريطة الروابط هنا خامسة، وكلتاهما عرضة للانحراف عن الأصل.
