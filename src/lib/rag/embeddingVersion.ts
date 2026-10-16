/**
 * هوية التضمين (D2 - ADR 0003): مفتاح واحد يميّز فضاء المتجهات الذي أنتج كل قطعة.
 *
 * بدونه كانت قطع نماذج ومُرمِّزات مختلفة تسكن الجدول نفسه بلا تمييز، فتختلط
 * فضاءات متجهات في نتيجة بحث واحدة. الختم يُكتب عند كل تخزين ويُقارَن عند كل
 * بحث: معرّف النموذج + نسخة المُرمِّز + الأبعاد.
 *
 * القطعة بلا ختم (كل ما خُزِّن قبل المخطط v6) قديمة بالتعريف: متجهاتها أنتجها
 * المُرمِّز البديل القديم، فاعتبارها حديثة هو الخطأ الذي يمنعه هذا الملف.
 */
import type { RagChunk } from "@/types";
import { db } from "@/lib/db/db";
import { getModelInfo } from "./modelCatalog";

/** الأجزاء الثلاثة التي تتغيّر بها دلالة المتجه. */
export interface EmbeddingIdentity {
  modelId: string;
  tokenizerVersion: string;
  dimensions: number;
}

/** سلسلة الهوية المخزّنة على كل قطعة. */
export function embeddingVersionOf(identity: EmbeddingIdentity): string {
  return identity.modelId + ":" + identity.tokenizerVersion + ":" + identity.dimensions;
}

/** هوية النموذج النشط، أو null إن كان المعرّف غير معروف. */
export function currentEmbeddingVersion(modelId: string): string | null {
  const info = getModelInfo(modelId);
  if (!info) return null;
  return embeddingVersionOf({
    modelId: info.modelId,
    tokenizerVersion: info.tokenizerVersion,
    dimensions: info.dimensions,
  });
}

/**
 * هل القطعة من فضاء آخر؟
 *
 * الغياب يُعدّ قديمًا لا حديثًا، وغياب الهوية النشطة أيضًا: لا يُبحَث بفضاء
 * مجهول، فالتصفية الافتراضية هي المنع.
 */
export function isChunkStale(
  chunk: Pick<RagChunk, "embeddingVersion">,
  activeVersion: string | null,
): boolean {
  if (activeVersion === null) return true;
  return chunk.embeddingVersion !== activeVersion;
}

/**
 * عدد القطع التي لا تنتمي إلى الفضاء النشط (أو بلا ختم).
 *
 * تسكن هنا لا في documentManager عمدًا: مستدعيها واجهة الحالة في مسار الإقلاع،
 * وdocumentManager يسحب معه embedder ثم onnxruntime-web، أي حزمة WASM كاملة إلى
 * الحمولة الفعلية عند الإقلاع - وهي الفجوة المسجّلة في LV-09.
 */
export async function countStaleChunks(activeVersion: string | null): Promise<number> {
  return db.rag_chunks.filter((chunk) => isChunkStale(chunk, activeVersion)).count();
}
