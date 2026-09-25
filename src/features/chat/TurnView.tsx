import { ResultCards } from "./ResultCards";
import { SummaryCard } from "./SummaryCard";
import { Markdown } from "./Markdown";
import type { ChatMessage } from "@/types";

export function TurnView({ prompts, results, layout, customPrompts, onToggleLayout, onStop, onRetry, disabled = false, stopDisabled = false }: {
  prompts: ChatMessage[]; results: ChatMessage[]; layout: "vertical" | "horizontal";
  customPrompts: Record<string, string | null>;
  onToggleLayout(): void; onStop(message: ChatMessage): void; onRetry(message: ChatMessage): void;
  disabled?: boolean;
  stopDisabled?: boolean | ((message: ChatMessage) => boolean);
}) {
  // Superseded rows remain durable for retry identity, but only the current attempt is visible.
  const visiblePrompts = prompts.filter((m) => !m.superseded);
  const visibleResults = results.filter((m) => !m.superseded);
  // رسائل الخلاصة (kind="synthesis") تُعرض أعلى التمرّة عبر SummaryCard، وبقية النتائج كالعادة.
  const syntheses = visibleResults.filter((m) => m.kind === "synthesis");
  const plain = visibleResults.filter((m) => m.kind !== "synthesis");
  return (
    <section className="border border-sura-border rounded-lg p-3 space-y-3">
      {visiblePrompts.filter((p) => p.promptKind === "shared").map((p) => (
        <blockquote key={p.id} className="border-r-2 border-sura-accent pr-3 text-sm"><Markdown text={p.text} /></blockquote>
      ))}
      {syntheses.map((m) => <SummaryCard key={m.id} msg={m} horizontal={layout === "horizontal"} />)}
      {plain.length > 0 && <ResultCards msgs={plain} layout={layout} customPrompts={customPrompts} onToggleLayout={onToggleLayout} onStop={onStop} onRetry={onRetry} disabled={disabled} stopDisabled={stopDisabled} />}
    </section>
  );
}
