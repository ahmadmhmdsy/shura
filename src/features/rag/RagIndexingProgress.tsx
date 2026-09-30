import { useState } from "react";
import { useRagStore } from "@/state/ragStore";
import { ar } from "@/i18n/ar";

export function RagIndexingProgress() {
  const progress = useRagStore((s) => s.indexingProgress);
  const [expanded, setExpanded] = useState(false);

  const percent = progress.totalFiles > 0
    ? Math.round((progress.completedFiles / progress.totalFiles) * 100)
    : 0;

  return (
    <div className="w-56 text-xs" dir="rtl">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded border border-sura-border hover:bg-sura-muted/10 transition-colors"
      >
        <span className="flex-1 h-1.5 rounded-full bg-sura-border overflow-hidden">
          <span
            className="block h-full bg-sura-accent transition-all"
            style={{ width: percent + "%" }}
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </span>
        <span className="text-sura-muted tabular-nums">{percent}%</span>
      </button>
      {expanded && (
        <div className="mt-1 px-2 py-1.5 rounded border border-sura-border space-y-1">
          <p>{ar.ragProgressTotal}: {progress.totalFiles}</p>
          <p>{ar.ragProgressCompleted}: {progress.completedFiles}</p>
          {progress.currentFile && (
            <p className="truncate">{ar.ragProgressCurrent}: {progress.currentFile}</p>
          )}
        </div>
      )}
    </div>
  );
}
