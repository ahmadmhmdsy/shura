/**
 * الكتالوج الوحيد لنماذج التضمين.
 *
 * كان الكتالوج مكرّرًا في ثلاثة مواضع — «embedder.ts» و«modelDownloader.ts»
 * و«reindexManager.ts» — مع خريطتَي روابط تنزيل رابعة وخامسة، فكانت إضافة نموذج
 * جديد تعني تعديل أربعة أماكن ويُنسى أحدها. هنا مصدر واحد يقرأ منه الجميع.
 *
 * الرابط جزء من الكتالوج عمدًا: بدونه كان لكل مستدعٍ خريطته الخاصة، وكانت خريطة
 * «embedder.ts» ترجع صامتةً إلى النموذج الافتراضي لنموذج غير معروف، أي تنزيل
 * نموذج مختلف وتسميته باسم النموذج المطلوب.
 */

import type { RagModel } from "@/types";

/** نموذج تضمين مع رابط تنزيله. */
export interface EmbeddingModelInfo extends RagModel {
  /** رابط تنزيل ONNX (مكمَّم) من HuggingFace. */
  url: string;
}

/** النماذج المتاحة، وهي نفسها المعروضة في إعدادات RAG. */
export const EMBEDDING_MODELS: EmbeddingModelInfo[] = [
  {
    id: "multilingual-e5-small",
    modelId: "multilingual-e5-small",
    label: "Multilingual E5 Small (recommended for Arabic)",
    dimensions: 384,
    downloadedAt: 0,
    sizeBytes: 130_000_000,
    url: "https://huggingface.co/Xenova/multilingual-e5-small/resolve/main/onnx/model_quantized.onnx",
  },
  {
    id: "multilingual-e5-base",
    modelId: "multilingual-e5-base",
    label: "Multilingual E5 Base (better quality, larger)",
    dimensions: 768,
    downloadedAt: 0,
    sizeBytes: 480_000_000,
    url: "https://huggingface.co/Xenova/multilingual-e5-base/resolve/main/onnx/model_quantized.onnx",
  },
  {
    id: "all-MiniLM-L6-v2",
    modelId: "all-MiniLM-L6-v2",
    label: "All MiniLM L6 v2 (English only, fast)",
    dimensions: 384,
    downloadedAt: 0,
    sizeBytes: 80_000_000,
    url: "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_quantized.onnx",
  },
];

/** النموذج الافتراضي حين لا يُحدَّد نموذج. */
export const DEFAULT_EMBEDDING_MODEL_ID = "multilingual-e5-small";

/** معلومات نموذج بمعرّفه، أو null إن كان المعرّف غير معروف. */
export function getModelInfo(modelId: string): EmbeddingModelInfo | null {
  return EMBEDDING_MODELS.find((m) => m.id === modelId) ?? null;
}

/**
 * رابط تنزيل النموذج.
 *
 * يرمي لنموذج غير معروف بدل الرجوع الصامت إلى الافتراضي: الرجوع الصامت كان
 * ينزّل نموذجًا آخر ثم يسمّيه باسم النموذج المطلوب، وهو خطأ أصعب تتبّعًا بكثير
 * من رسالة صريحة.
 */
export function getModelUrl(modelId: string): string {
  const model = getModelInfo(modelId);
  if (!model) throw new Error(`Unknown embedding model: ${modelId}`);
  return model.url;
}
