import { useState } from "react";
import { ArrowLeftRight, Copy, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ResultCard } from "./ResultCard";
import { ar } from "@/i18n/ar";
import type { ChatMessage } from "@/types";

export function ResultCards({ msgs, layout, customPrompts, onToggleLayout, onStop, onRetry, disabled = false, stopDisabled = false }: {
  msgs: ChatMessage[]; layout: "vertical" | "horizontal";
  customPrompts: Record<string, string | null>;
  onToggleLayout(): void; onStop(message: ChatMessage): void; onRetry(message: ChatMessage): void;
  disabled?: boolean;
  stopDisabled?: boolean | ((message: ChatMessage) => boolean);
}) {
  const horizontal = layout === "horizontal";
  const [bestAnswerId, setBestAnswerId] = useState<string | null>(null);
  const hasStreaming = msgs.some((m) => m.status === "streaming");
  const hasMultiple = msgs.length > 1;

  const handleCopyAll = async () => {
    const text = msgs.map((m) => {
      const label = m.modelId;
      return "=== " + label + " ===\n" + m.text;
    }).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("تم نسخ جميع الإجابات");
    } catch {
      toast.error("تعذر النسخ");
    }
  };

  const handleStopAll = () => {
    msgs.filter((m) => m.status === "streaming").forEach((m) => onStop(m));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onToggleLayout}><ArrowLeftRight className="size-4" /> {horizontal ? "عمودي" : "أفقي"}</Button>
        <div className="flex-1" />
        {hasStreaming && (
          <Button size="sm" variant="ghost" onClick={handleStopAll}><Square className="size-4" /> {ar.stopAll}</Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => void handleCopyAll()}><Copy className="size-4" /> {ar.copyAll}</Button>
      </div>
      <div className={horizontal ? "flex gap-3 overflow-x-auto pb-2" : "flex flex-col gap-3"}>
        {msgs.map((m) => (
          <ResultCard
            key={m.id}
            msg={m}
            horizontal={horizontal}
            customPrompt={customPrompts[m.targetId ?? ""] ?? null}
            onStop={onStop}
            onRetry={onRetry}
            disabled={disabled}
            stopDisabled={stopDisabled}
            isBestAnswer={bestAnswerId === m.id}
            onMarkBest={hasMultiple ? () => setBestAnswerId(bestAnswerId === m.id ? null : m.id) : undefined}
          />
        ))}
      </div>
    </div>
  );
}