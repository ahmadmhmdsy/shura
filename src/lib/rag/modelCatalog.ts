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
import type { AssetDigest } from "./verifiedDownload";

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
   * تبقى «@main» عمدًا رغم تثبيت الروابط على commit: تغييرها يُبطل كل الفهارس
   * المخزّنة، والملف المنزَّل نفسه يُطابَق ببصمة `integrity.tokenizer`.
   */
  tokenizerVersion: string;
  /**
   * Size and SHA-256 of each asset, checked before the bytes are cached. The URLs name
   * an exact commit rather than `main`, so these values cannot drift under the app.
   */
  integrity: {
    model: AssetDigest;
    tokenizer: AssetDigest;
    tokenizerConfig: AssetDigest;
  };
}

const HF = "https://huggingface.co/Xenova/";

/** النماذج المتاحة، وهي نفسها المعروضة في إعدادات RAG. */
export const EMBEDDING_MODELS: EmbeddingModelInfo[] = [
  {
    id: "multilingual-e5-small",
    modelId: "multilingual-e5-small",
    label: "Multilingual E5 Small (recommended for Arabic)",
    dimensions: 384,
    downloadedAt: 0,
    sizeBytes: 130_000_000,
    url: HF + "multilingual-e5-small/resolve/761b726dd34fb83930e26aab4e9ac3899aa1fa78/onnx/model_quantized.onnx",
    tokenizerUrl: HF + "multilingual-e5-small/resolve/761b726dd34fb83930e26aab4e9ac3899aa1fa78/tokenizer.json",
    tokenizerConfigUrl: HF + "multilingual-e5-small/resolve/761b726dd34fb83930e26aab4e9ac3899aa1fa78/tokenizer_config.json",
    tokenizerVersion: "Xenova/multilingual-e5-small@main",
    integrity: {
      model: { bytes: 118_308_185, sha256: "f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193" },
      tokenizer: { bytes: 17_082_730, sha256: "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39" },
      tokenizerConfig: { bytes: 443, sha256: "a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b" },
    },
  },
  {
    id: "multilingual-e5-base",
    modelId: "multilingual-e5-base",
    label: "Multilingual E5 Base (better quality, larger)",
    dimensions: 768,
    downloadedAt: 0,
    sizeBytes: 480_000_000,
    url: HF + "multilingual-e5-base/resolve/1ec9243030a27d1a115d5c340572074c125b58b2/onnx/model_quantized.onnx",
    tokenizerUrl: HF + "multilingual-e5-base/resolve/1ec9243030a27d1a115d5c340572074c125b58b2/tokenizer.json",
    tokenizerConfigUrl: HF + "multilingual-e5-base/resolve/1ec9243030a27d1a115d5c340572074c125b58b2/tokenizer_config.json",
    tokenizerVersion: "Xenova/multilingual-e5-base@main",
    integrity: {
      model: { bytes: 278_647_662, sha256: "df7a9a29309e3ad491e1783adf8baee710262cc06079c7cbab63c630277fac94" },
      tokenizer: { bytes: 17_082_660, sha256: "62c24cdc13d4c9952d63718d6c9fa4c287974249e16b7ade6d5a85e7bbb75626" },
      tokenizerConfig: { bytes: 418, sha256: "efb5c0d09722e5fe59a462cd2a9976ee216d55b037597d997cd3fe833216da15" },
    },
  },
  {
    id: "all-MiniLM-L6-v2",
    modelId: "all-MiniLM-L6-v2",
    label: "All MiniLM L6 v2 (English only, fast)",
    dimensions: 384,
    downloadedAt: 0,
    sizeBytes: 80_000_000,
    url: HF + "all-MiniLM-L6-v2/resolve/751bff37182d3f1213fa05d7196b954e230abad9/onnx/model_quantized.onnx",
    tokenizerUrl: HF + "all-MiniLM-L6-v2/resolve/751bff37182d3f1213fa05d7196b954e230abad9/tokenizer.json",
    tokenizerConfigUrl: HF + "all-MiniLM-L6-v2/resolve/751bff37182d3f1213fa05d7196b954e230abad9/tokenizer_config.json",
    tokenizerVersion: "Xenova/all-MiniLM-L6-v2@main",
    integrity: {
      model: { bytes: 22_972_370, sha256: "afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1" },
      tokenizer: { bytes: 711_661, sha256: "da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0" },
      tokenizerConfig: { bytes: 366, sha256: "9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3" },
    },
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
