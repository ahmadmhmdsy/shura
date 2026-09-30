import { useState } from "react";
import { AlertCircle, RotateCcw } from "lucide-react";
import { ResultCards } from "./ResultCards";
import { SummaryCard } from "./SummaryCard";
import { Markdown } from "./Markdown";
import { ar } from "@/i18n/ar";
import type { ChatMessage } from "@/types";

export function TurnView({ prompts, results, layout, customPrompts, onToggleLayout, onStop, onRetry, disabled = false, stopDisabled = false, toolActivity, toolErrors = {}, onToolError }: {
  prompts: ChatMessage[]; results: ChatMessage[]; layout: "vertical" | "horizontal";
  customPrompts: Record<string, string | null>;
  onToggleLayout(): void; onStop(message: ChatMessage): void; onRetry(message: ChatMessage): void;
  disabled?: boolean;
  stopDisabled?: boolean | ((message: ChatMessage) => boolean);
  toolActivity?: Record<string, string>;
  toolErrors?: Record<string, { toolName: string; error: string }>;
  onToolError?: (targetId: string, toolName: string, error: string) => void;
}) {
  // Superseded rows remain durable for retry identity, but only the current attempt is visible.
  const visiblePrompts = prompts.filter((m) => !m.superseded);
  const visibleResults = results.filter((m) => !m.superseded);
  // رسائل الخلاصة (kind="synthesis") تُعرض أعلى التمرّة عبر SummaryCard، وبقية النتائج كالعادة.
  const syntheses = visibleResults.filter((m) => m.kind === "synthesis");
  const plain = visibleResults.filter((m) => m.kind !== "synthesis");
  const [errorSummaryDismissed, setErrorSummaryDismissed] = useState(false);
  const errorResults = plain.filter((m) => m.status === "error");
  const showErrorSummary = errorResults.length > 0 && !errorSummaryDismissed;
  // أخطاء الأدوات لكل هدف: تُعرض كمُلاحظات قابلة للإخفاء حتى لا تُربك التمرّة الجارية.
  const [dismissedToolErrors, setDismissedToolErrors] = useState<Record<string, boolean>>({});
  const visibleToolErrors = Object.entries(toolErrors).filter(([targetId, error]) =>
    !dismissedToolErrors[targetId] && error.error.length > 0 && results.some((r) => r.targetId === targetId),
  );
  return (
    <section className="border border-sura-border rounded-lg p-3 space-y-3">
      {showErrorSummary && (
        <div className="flex items-center gap-2 rounded border border-sura-danger/40 bg-sura-danger/10 px-3 py-2" role="alert">
          <AlertCircle className="size-4 text-sura-danger shrink-0" />
          <span className="text-sm text-sura-danger flex-1">
            {ar.errorSummary}: {errorResults.length} {errorResults.length === 1 ? "نتيجة" : "نتائج"}
          </span>
          <button
            type="button"
            className="text-xs text-sura-muted hover:text-sura-foreground transition-colors flex items-center gap-1"
            onClick={() => { errorResults.forEach((m) => onRetry(m)); }}
          >
            <RotateCcw className="size-3" /> {ar.errorRetryAll}
          </button>
          <button
            type="button"
            className="text-xs text-sura-muted hover:text-sura-foreground transition-colors"
            onClick={() => setErrorSummaryDismissed(true)}
          >
            {ar.errorDismiss}
          </button>
        </div>
      )}
      {visiblePrompts.filter((p) => p.promptKind === "shared").map((p) => (
        <blockquote key={p.id} className="border-r-2 border-sura-accent pr-3 text-sm"><Markdown text={p.text} /></blockquote>
      ))}
      {syntheses.map((m) => <SummaryCard key={m.id} msg={m} horizontal={layout === "horizontal"} />)}
      {Object.keys(toolActivity ?? {}).some((tid) => results.some((r) => r.targetId === tid)) && (
        <div className="flex items-center gap-2 text-xs text-sura-accent" role="status">
          <span className="size-1.5 rounded-full bg-sura-accent animate-pulse" />
          {ar.ragSearchingDocuments}
        </div>
      )}
      {visibleToolErrors.length > 0 && (
        <div className="rounded border border-sura-danger/40 bg-sura-danger/10 px-3 py-2 space-y-2" role="alert">
          {visibleToolErrors.map(([targetId, error]) => {
            const targetMessage = results.find((r) => r.targetId === targetId);
            return (
              <div key={targetId} className="flex items-center gap-2">
                <AlertCircle className="size-4 text-sura-danger shrink-0" />
                <span className="text-sm text-sura-danger flex-1">
                  {error.error}
                </span>
                <button
                  type="button"
                  className="text-xs text-sura-muted hover:text-sura-foreground transition-colors flex items-center gap-1"
                  onClick={() => {
                    if (targetMessage) onRetry(targetMessage);
                  }}
                >
                  <RotateCcw className="size-3" /> {ar.errorRetry}
                </button>
                <button
                  type="button"
                  className="text-xs text-sura-muted hover:text-sura-foreground transition-colors"
                  onClick={() => {
                    setDismissedToolErrors((prev) => ({ ...prev, [targetId]: true }));
                    onToolError?.(targetId, error.toolName, error.error);
                  }}
                >
                  {ar.errorDismiss}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {plain.length > 0 && <ResultCards msgs={plain} layout={layout} customPrompts={customPrompts} onToggleLayout={onToggleLayout} onStop={onStop} onRetry={onRetry} disabled={disabled} stopDisabled={stopDisabled} />}
    </section>
  );
}
