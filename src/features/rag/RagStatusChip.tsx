import { useRagStore } from "@/state/ragStore";
import { ar } from "@/i18n/ar";
import type { RagDocument, RagFolder } from "@/types";

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
  const summary = summarizeRagStatus(documents, folders, indexingErrors);

  const errorDetails = Object.entries(indexingErrors)
    .map(([fileId, error]) => fileId + ": " + error)
    .join("\n");

  return (
    <button
      type="button"
      onClick={onOpenSettings}
      className={"flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors " + (
        summary.tone === "muted" ? "border-sura-border text-sura-muted" :
        summary.tone === "active" ? "border-sura-accent text-sura-accent" :
        summary.tone === "warn" ? "border-sura-warn text-sura-warn" :
        "border-sura-border text-sura-foreground"
      )}
      title={errorDetails || ar.ragFiles}
    >
      {summary.tone === "active" && <span className="size-1.5 rounded-full bg-sura-accent animate-pulse" />}
      {summary.label}
    </button>
  );
}
