import { ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResultCard } from "./ResultCard";
import type { ChatMessage } from "@/types";

export function ResultCards({ msgs, layout, customPrompts, onToggleLayout, onStop, onRetry }: {
  msgs: ChatMessage[]; layout: "vertical" | "horizontal";
  customPrompts: Record<string, string | null>;
  onToggleLayout(): void; onStop(targetId: string): void; onRetry(targetId: string): void;
}) {
  const horizontal = layout === "horizontal";
  return (
    <div className="space-y-2">
      <div className="flex justify-start"><Button size="sm" variant="ghost" onClick={onToggleLayout}><ArrowLeftRight className="size-4" /> {horizontal ? "عمودي" : "أفقي"}</Button></div>
      <div className={horizontal ? "flex gap-3 overflow-x-auto pb-2" : "flex flex-col gap-3"}>
        {msgs.map((m) => <ResultCard key={m.id} msg={m} horizontal={horizontal} customPrompt={customPrompts[m.targetId ?? ""] ?? null} onStop={onStop} onRetry={onRetry} />)}
      </div>
    </div>
  );
}
