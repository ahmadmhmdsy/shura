/**
 * كاتب كاش النماذج الوحيد (المهمة T1.6، الملاحظة NL-05).
 *
 * كان جدولا `rag_models` و`rag_model_blobs` يُكتبان من موضعين: مسار التنزيل
 * الصريح في «modelDownloader» يكتب تسمية الكتالوج وأبعاده، والمسار الكسول في
 * «embedder» يكتب معرّف النموذج تسميةً وأبعادًا قدّمها المستدعي. فكان الصف الوصفي
 * يختلف باختلاف من نزّل النموذج أولًا - تسميةً معروضة في الإعدادات وأبعادًا
 * تُبنى عليها هوية التضمين - وكلاهما يجب أن يأتي من الكتالوج لا من المستدعي.
 * هنا مصدر واحد، فلا نسختان تتباعدان.
 *
 * الصف الوصفي خفيف والبايتات في جدول منفصل، فسؤال «هل النموذج منزَّل؟» لا يسحب
 * مئات الميغابايتات. والجدولان يضمان أيضًا ملفَّي المُرمِّز، لأن كليهما أصل منزَّل
 * يجب أن يُحذف مع النموذج.
 */

import { db } from "@/lib/db/db";
import type { RagModel } from "@/types";
import { getModelInfo, tokenizerAssetId } from "./modelCatalog";

/** الصف الوصفي لنموذج منزَّل، أو undefined إن لم يُنزَّل بعد. */
export async function getModel(modelId: string): Promise<RagModel | undefined> {
  return db.rag_models.get(modelId);
}

/** بايتات النموذج المنزَّل، أو null إن لم يُنزَّل بعد. */
export async function getModelBytes(modelId: string): Promise<ArrayBuffer | null> {
  const row = await db.rag_model_blobs.get(modelId);
  return row?.bytes ?? null;
}

/** كل النماذج المنزَّلة. */
export async function listModels(): Promise<RagModel[]> {
  return db.rag_models.toArray();
}

/**
 * كتابة نموذج منزَّل: صف وصفي وبايتات في معاملة واحدة.
 *
 * الوصف يُقرأ من الكتالوج لا من المستدعي، لأن المستدعي يمرّر ما يعرفه عن النموذج
 * لا ما هو عليه. ويرمي لنموذج غير معروف ولأي فشل كتابة: التنزيل الصريح يجب أن
 * يعرف أن ما نزّله (مئات الميغابايتات) لم يُحفظ، بدل أن يخبر المستخدم بنجاح كاذب.
 */
export async function putModel(modelId: string, bytes: ArrayBuffer): Promise<void> {
  const model = getModelInfo(modelId);
  if (!model) throw new Error(`Unknown embedding model: ${modelId}`);

  await db.transaction("rw", [db.rag_models, db.rag_model_blobs], async () => {
    await db.rag_models.put({
      id: modelId,
      modelId,
      label: model.label,
      dimensions: model.dimensions,
      downloadedAt: Date.now(),
      sizeBytes: bytes.byteLength,
    });
    await db.rag_model_blobs.put({ id: modelId, bytes });
  });
}

/**
 * كتابة غير قاتلة للمسار الكسول: البايتات محمّلة في الذاكرة والتضمين تمّ فعلًا،
 * فإفشال استدعاء نجح لأن الكاش لم يُكتب يخسر عملًا مقابل لا شيء، وإعادة التنزيل
 * لاحقًا أرخص من ذلك. هذا هو الموضع الوحيد الذي يُمتصّ فيه فشل كتابة النموذج.
 */
export async function putModelQuietly(modelId: string, bytes: ArrayBuffer): Promise<boolean> {
  try {
    await putModel(modelId, bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * حذف النموذج: صفّه وبايتاته وملفَّا مُرمِّزه.
 *
 * ملفّا المُرمِّز يُحذفان مع النموذج: بقاؤهما يترك 16.29 ميبيبايت بلا مستخدم،
 * وحذفهما يجعل «حذف النموذج» يعني تحرير كل ما نزّله النموذج فعلًا.
 */
export async function deleteModel(modelId: string): Promise<void> {
  await db.transaction("rw", [db.rag_models, db.rag_model_blobs], async () => {
    await db.rag_models.delete(modelId);
    await db.rag_model_blobs.delete(modelId);
    await db.rag_model_blobs.bulkDelete([
      tokenizerAssetId(modelId, "tokenizer.json"),
      tokenizerAssetId(modelId, "tokenizer_config.json"),
    ]);
  });
}

/** قراءة أصل منزَّل من الكاش (ملف مُرمِّز)، أو null إن لم يُنزَّل بعد. */
export async function getTokenizerAsset(assetId: string): Promise<ArrayBuffer | null> {
  try {
    const row = await db.rag_model_blobs.get(assetId);
    return row?.bytes ?? null;
  } catch {
    return null;
  }
}

/** كتابة أصل منزَّل في الكاش. فشل الكتابة غير قاتل، فالتنزيل نفسه نجح. */
export async function putTokenizerAsset(assetId: string, bytes: ArrayBuffer): Promise<void> {
  try {
    await db.rag_model_blobs.put({ id: assetId, bytes });
  } catch {
    // فشل الكاش غير قاتل
  }
}
