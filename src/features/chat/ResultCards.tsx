import { useState } from "react";
import { ArrowLeftRight, Copy, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ResultCard } from "./ResultCard";
import { useUiText } from "@/i18n";
import type { ChatMessage } from "@/types";

export function ResultCards({ msgs, layout, customPrompts, onToggleLayout, onStop, onRetry, disabled = false, stopDisabled = false }: {
  msgs: ChatMessage[]; layout: "vertical" | "horizontal";
  customPrompts: Record<string, string | null>;
  onToggleLayout(): void; onStop(message: ChatMessage): void; onRetry(message: ChatMessage): void;
  disabled?: boolean;
  stopDisabled?: boolean | ((message: ChatMessage) => boolean);
}) {
  const { t } = useUiText();
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
      toast.success(t("chat.copyAllSuccess"));
    } catch {
      toast.error(t("chat.copyAllError"));
    }
  };

  const handleStopAll = () => {
    msgs.filter((m) => m.status === "streaming").forEach((m) => onStop(m));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onToggleLayout}><ArrowLeftRight className="size-4" /> {horizontal ? t("settings.vertical") : t("settings.horizontal")}</Button>
        <div className="flex-1" />
        {hasStreaming && (
          <Button size="sm" variant="ghost" onClick={handleStopAll}><Square className="size-4" /> {t("chat.stopAll")}</Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => void handleCopyAll()}><Copy className="size-4" /> {t("chat.copyAll")}</Button>
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