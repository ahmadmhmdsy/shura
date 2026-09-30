import { useRagStore } from "@/state/ragStore";
import { ar } from "@/i18n/ar";
import type { RagDocument, RagFolder } from "@/types";

export type RagStatusTone = "muted" | "active" | "warn" | "ok";

export interface RagStatusSummary {
  label: string;
  tone: RagStatusTone;
}

export function summarizeRagStatus(documents: RagDocument[], folders: RagFolder[]): RagStatusSummary {
  const indexing = documents.filter((d) => d.status === "indexing").length;
  const errors = documents.filter((d) => d.status === "error").length;
  const indexed = documents.filter((d) => d.status === "indexed").length;

  if (documents.length === 0 && folders.length === 0) {
    return { label: ar.ragChipNothing, tone: "muted" };
  }
  if (indexing > 0) {
    return { label: ar.ragChipIndexing, tone: "active" };
  }
  if (errors > 0) {
    return { label: errors + " " + ar.ragChipErrors, tone: "warn" };
  }
  const folderPart = folders.length > 0 ? " · " + folders.length + " " + ar.ragFolderFiles : "";
  return { label: indexed + " " + ar.ragChipIndexed + folderPart, tone: "ok" };
}

export function RagStatusChip({ onOpenSettings }: { onOpenSettings(): void }) {
  const documents = useRagStore((s) => s.documents);
  const folders = useRagStore((s) => s.folders);
  const summary = summarizeRagStatus(documents, folders);

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
      title={ar.ragFiles}
    >
      {summary.tone === "active" && <span className="size-1.5 rounded-full bg-sura-accent animate-pulse" />}
      {summary.label}
    </button>
  );
}
