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

/** نموذج تضمين مع روابط أصوله. */
export interface EmbeddingModelInfo extends RagModel {
  /** رابط تنزيل ONNX (مكمَّم) من HuggingFace. */
  url: string;
  /** رابط مُرمِّز النموذج: بدونه لا يمكن تحويل النص إلى معرّفات صحيحة. */
  tokenizerUrl: string;
  /** رابط إعدادات المُرمِّز، وهي المدخل الثاني لبناء المُرمِّز. */
  tokenizerConfigUrl: string;
  /**
   * نسخة المُرمِّز، وهي جزء من هوية التضمين (D2): تُختم على كل قطعة، فتغيّرها
   * يُبطل كل المتجهات المخزّنة بدل أن تختلط متجهات من فضاءين.
   *
   * القيمة هنا مصدر المُرمِّز المثبَّت (المستودع@المراجعة)، وليست بصمة محتوى:
   * بصمة الملف المقيسة مثبتة في الاختبار المرجعي (T1.1) وفي ADR 0003.
   */
  tokenizerVersion: string;
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
    tokenizerUrl: "https://huggingface.co/Xenova/multilingual-e5-small/resolve/main/tokenizer.json",
    tokenizerConfigUrl: "https://huggingface.co/Xenova/multilingual-e5-small/resolve/main/tokenizer_config.json",
    tokenizerVersion: "Xenova/multilingual-e5-small@main",
  },
  {
    id: "multilingual-e5-base",
    modelId: "multilingual-e5-base",
    label: "Multilingual E5 Base (better quality, larger)",
    dimensions: 768,
    downloadedAt: 0,
    sizeBytes: 480_000_000,
    url: "https://huggingface.co/Xenova/multilingual-e5-base/resolve/main/onnx/model_quantized.onnx",
    tokenizerUrl: "https://huggingface.co/Xenova/multilingual-e5-base/resolve/main/tokenizer.json",
    tokenizerConfigUrl: "https://huggingface.co/Xenova/multilingual-e5-base/resolve/main/tokenizer_config.json",
    tokenizerVersion: "Xenova/multilingual-e5-base@main",
  },
  {
    id: "all-MiniLM-L6-v2",
    modelId: "all-MiniLM-L6-v2",
    label: "All MiniLM L6 v2 (English only, fast)",
    dimensions: 384,
    downloadedAt: 0,
    sizeBytes: 80_000_000,
    url: "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_quantized.onnx",
    tokenizerUrl: "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/tokenizer.json",
    tokenizerConfigUrl: "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/tokenizer_config.json",
    tokenizerVersion: "Xenova/all-MiniLM-L6-v2@main",
  },
];

/** النموذج الافتراضي حين لا يُحدَّد نموذج. */
export const DEFAULT_EMBEDDING_MODEL_ID = "multilingual-e5-small";

/**
 * مفتاح تخزين ملف من ملفَّي المُرمِّز في كاش النماذج (rag_model_blobs).
 *
 * المفتاح مشتقّ من معرّف النموذج واسم الملف، ويسكن الجدول نفسه الذي تسكنه بايتات
 * النموذج، لأن كليهما أصل منزَّل يجب أن يُحذف مع النموذج.
 */
export function tokenizerAssetId(
  modelId: string,
  fileName: "tokenizer.json" | "tokenizer_config.json",
): string {
  return `tokenizer:` + modelId + `:` + fileName;
}

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
