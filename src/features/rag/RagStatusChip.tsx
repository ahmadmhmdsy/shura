import { useEffect, useState } from "react";
import { useRagStore } from "@/state/ragStore";
import { countStaleChunks, currentEmbeddingVersion } from "@/lib/rag/embeddingVersion";
import { uiText, useUiText } from "@/i18n";
import type { RagDocument, RagFolder } from "@/types";
import { RagIndexingProgress } from "./RagIndexingProgress";

export type RagStatusTone = "muted" | "active" | "warn" | "ok";

export interface RagStatusSummary {
  label: string;
  tone: RagStatusTone;
}

export function summarizeRagStatus(
  documents: RagDocument[],
  folders: RagFolder[],
  indexingErrors: Record<string, string> = {},
  staleChunks: number = 0
): RagStatusSummary {
  const indexing = documents.filter((d) => d.status === "indexing").length;
  const docErrors = documents.filter((d) => d.status === "error").length;
  const indexed = documents.filter((d) => d.status === "indexed").length;
  const indexingErrorCount = Object.keys(indexingErrors).length;
  const totalErrors = docErrors + indexingErrorCount;

  if (documents.length === 0 && folders.length === 0) {
    return { label: uiText.t("rag.chipNothing"), tone: "muted" };
  }
  if (indexing > 0) {
    return { label: uiText.t("rag.chipIndexing"), tone: "active" };
  }
  if (totalErrors > 0) {
    return { label: uiText.plural("rag.chipErrors", totalErrors), tone: "warn" };
  }
  // القطع القديمة تُعلن عن نفسها هنا: بدونها كان المستخدم يرى نتائج بحث فارغة
  // بلا سبب بعد تغيير نموذج التضمين (T1.2).
  if (staleChunks > 0) {
    return { label: uiText.plural("rag.chipStale", staleChunks), tone: "warn" };
  }
  const folderPart = folders.length > 0 ? " · " + uiText.plural("rag.folderFiles", folders.length) : "";
  return { label: uiText.plural("rag.chipIndexed", indexed) + folderPart, tone: "ok" };
}

export function RagStatusChip({ onOpenSettings }: { onOpenSettings(): void }) {
  const { t } = useUiText();
  const documents = useRagStore((s) => s.documents);
  const folders = useRagStore((s) => s.folders);
  const indexingErrors = useRagStore((s) => s.indexingErrors);
  const embeddingModelId = useRagStore((s) => s.settings.embeddingModelId);
  const [staleChunks, setStaleChunks] = useState(0);
  const indexingProgress = useRagStore((s) => s.indexingProgress);
  const summary = summarizeRagStatus(documents, folders, indexingErrors, staleChunks);

  // يُعاد الحساب عند تغيّر النموذج أو المستندات؛ الخطأ هنا لا يجوز أن يُسقط
  // الشريحة كلها، فيُعرض صفر خطأ بدل حالة معلّقة.
  useEffect(() => {
    let active = true;
    countStaleChunks(currentEmbeddingVersion(embeddingModelId))
      .then((count) => {
        if (active) setStaleChunks(count);
      })
      .catch(() => {
        if (active) setStaleChunks(0);
      });
    return () => {
      active = false;
    };
  }, [embeddingModelId, documents]);

  const errorDetails = Object.entries(indexingErrors)
    .map(([fileId, error]) => fileId + ": " + error)
    .join("\n");

  const indexing = summary.tone === "active" || indexingProgress.status === "indexing";
  const percent = indexingProgress.totalFiles > 0
    ? Math.round((indexingProgress.completedFiles / indexingProgress.totalFiles) * 100)
    : 0;

  return (
    <div className="flex flex-col items-start gap-1" role="status" aria-live="polite" aria-atomic="true">
      <button
        type="button"
        onClick={onOpenSettings}
        className={"flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors " + (
          summary.tone === "muted" ? "border-sura-border text-sura-muted" :
          summary.tone === "active" ? "border-sura-accent text-sura-accent" :
          summary.tone === "warn" ? "border-sura-warn text-sura-warn" :
          "border-sura-border text-sura-foreground"
        )}
        aria-label={t("rag.files") + ": " + summary.label}
        title={errorDetails || t("rag.files")}
      >
        {summary.tone === "active" && <span className="size-1.5 rounded-full bg-sura-accent animate-pulse" aria-hidden="true" />}
        {summary.label}
        {indexing && (
          <span className="inline-flex items-center gap-1" dir="ltr">
            <span className="w-14 h-1 rounded-full bg-sura-border overflow-hidden">
              <span
              className="block h-full bg-sura-accent"
              style={{ width: percent + "%" }}
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            />
            </span>
            <span className="tabular-nums text-[length:var(--sura-text-micro)]">{percent}%</span>
          </span>
        )}
      </button>
      {indexing && <RagIndexingProgress />}
    </div>
  );
}
