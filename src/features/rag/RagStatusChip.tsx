import { useRagStore } from "@/state/ragStore";
import { ar } from "@/i18n/ar";
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
  indexingErrors: Record<string, string> = {}
): RagStatusSummary {
  const indexing = documents.filter((d) => d.status === "indexing").length;
  const docErrors = documents.filter((d) => d.status === "error").length;
  const indexed = documents.filter((d) => d.status === "indexed").length;
  const indexingErrorCount = Object.keys(indexingErrors).length;
  const totalErrors = docErrors + indexingErrorCount;

  if (documents.length === 0 && folders.length === 0) {
    return { label: ar.ragChipNothing, tone: "muted" };
  }
  if (indexing > 0) {
    return { label: ar.ragChipIndexing, tone: "active" };
  }
  if (totalErrors > 0) {
    return { label: totalErrors + " " + ar.ragChipErrors, tone: "warn" };
  }
  const folderPart = folders.length > 0 ? " · " + folders.length + " " + ar.ragFolderFiles : "";
  return { label: indexed + " " + ar.ragChipIndexed + folderPart, tone: "ok" };
}

export function RagStatusChip({ onOpenSettings }: { onOpenSettings(): void }) {
  const documents = useRagStore((s) => s.documents);
  const folders = useRagStore((s) => s.folders);
  const indexingErrors = useRagStore((s) => s.indexingErrors);
  const indexingProgress = useRagStore((s) => s.indexingProgress);
  const summary = summarizeRagStatus(documents, folders, indexingErrors);

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
        aria-label={ar.ragFiles + ": " + summary.label}
        title={errorDetails || ar.ragFiles}
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
            <span className="tabular-nums text-[10px]">{percent}%</span>
          </span>
        )}
      </button>
      {indexing && <RagIndexingProgress />}
    </div>
  );
}
