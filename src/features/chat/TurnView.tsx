import { ResultCards } from "./ResultCards";
import { SummaryCard } from "./SummaryCard";
import { Markdown } from "./Markdown";
import type { ChatMessage } from "@/types";

export function TurnView({ prompts, results, layout, customPrompts, onToggleLayout, onStop, onRetry }: {
  prompts: ChatMessage[]; results: ChatMessage[]; layout: "vertical" | "horizontal";
  customPrompts: Record<string, string | null>;
  onToggleLayout(): void; onStop(targetId: string): void; onRetry(targetId: string): void;
}) {
  // رسائل الخلاصة (kind="synthesis") تُعرض أعلى التمرّة عبر SummaryCard، وبقية النتائج كالعادة.
  const syntheses = results.filter((m) => m.kind === "synthesis");
  const plain = results.filter((m) => m.kind !== "synthesis");
  return (
    <section className="border border-sura-border rounded-lg p-3 space-y-3">
      {prompts.filter((p) => p.promptKind === "shared").map((p) => (
        <blockquote key={p.id} className="border-r-2 border-sura-accent pr-3 text-sm"><Markdown text={p.text} /></blockquote>
      ))}
      {syntheses.map((m) => <SummaryCard key={m.id} msg={m} horizontal={layout === "horizontal"} />)}
      {plain.length > 0 && <ResultCards msgs={plain} layout={layout} customPrompts={customPrompts} onToggleLayout={onToggleLayout} onStop={onStop} onRetry={onRetry} />}
    </section>
  );
}
