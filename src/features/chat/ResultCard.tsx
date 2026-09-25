import { useState } from "react";
import { Copy, RotateCcw, Square, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "./Markdown";
import { PROVIDERS } from "@/lib/providers/registry";
import { ar } from "@/i18n/ar";
import type { ChatMessage } from "@/types";

const COPY_ERROR_MESSAGE = "تعذر نسخ النص";

async function copyText(text: string): Promise<void> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      throw new Error("clipboard unavailable");
    }
    await navigator.clipboard.writeText(text);
  } catch {
    toast.error(COPY_ERROR_MESSAGE);
  }
}

export interface ResultCardProps {
  msg: ChatMessage; customPrompt: string | null; horizontal: boolean;
  onStop(message: ChatMessage): void; onRetry(message: ChatMessage): void;
  disabled?: boolean;
  stopDisabled?: boolean | ((message: ChatMessage) => boolean);
}

export function ResultCard({ msg, customPrompt, horizontal, onStop, onRetry, disabled = false, stopDisabled = false }: ResultCardProps) {
  const cardStopDisabled = typeof stopDisabled === "function" ? stopDisabled(msg) : stopDisabled;
  const [openCustom, setOpenCustom] = useState(false);
  const label = msg.providerId ? PROVIDERS[msg.providerId].label : "—";
  const usage = msg.usage;
  return (
    <div className={"border border-sura-border rounded-lg bg-sura-bg flex flex-col " + (horizontal ? "min-w-80 flex-1" : "w-full")}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-sura-border">
        <Badge variant="secondary">{label}</Badge>
        <span className="text-xs text-sura-muted truncate">{msg.modelId}</span>
        <div className="flex-1" />
        <Button size="icon" variant="ghost" aria-label="نسخ" onClick={() => { void copyText(msg.text); }}><Copy className="size-3.5" /></Button>
        {msg.status === "streaming"
          ? <Button size="icon" variant="ghost" aria-label={ar.stop} disabled={cardStopDisabled} onClick={() => onStop(msg)}><Square className="size-3.5" /></Button>
          : <Button size="icon" variant="ghost" aria-label="إعادة" disabled={disabled} onClick={() => onRetry(msg)}><RotateCcw className="size-3.5" /></Button>}
      </div>
      {customPrompt && (
        <div className="border-b border-sura-border px-3 py-1.5">
          <button className="text-xs text-sura-muted flex items-center gap-1" onClick={() => setOpenCustom(!openCustom)}>
            <ChevronDown className={"size-3.5 transition-transform " + (openCustom ? "" : "-rotate-90")} /> السؤال المخصص
          </button>
          {openCustom && <p className="text-xs mt-1 whitespace-pre-wrap">{customPrompt}</p>}
        </div>
      )}
      <div role="status" aria-live="polite" aria-busy={msg.status === "streaming"} className="p-3 flex-1 overflow-y-auto">
        {msg.status === "streaming" && <span className="block text-xs text-sura-muted animate-pulse">{ar.streaming}</span>}
        {msg.status === "stopped" && <span className="block text-xs text-sura-warn">{ar.stopped}</span>}
        {msg.status === "error" && msg.error && <p className="text-sura-danger text-sm">{msg.error}</p>}
        {msg.text && <Markdown text={msg.text} />}
        {msg.sidecarWarning && <p className="mt-2 text-xs text-sura-warn whitespace-pre-wrap">{msg.sidecarWarning}</p>}
      </div>
      <div className="px-3 py-1.5 border-t border-sura-border text-[11px] text-sura-muted flex gap-3">
        {usage ? <><span>↓ {usage.inputTokens}</span><span>↑ {usage.outputTokens}</span><span>كاش {usage.cachedInputTokens}</span>{usage.cacheWriteInputTokens ? <span>كتابة كاش {usage.cacheWriteInputTokens}</span> : null}<span>{usage.costUSD == null ? "—" : "$" + usage.costUSD.toFixed(6)}</span></> : <span>—</span>}
      </div>
    </div>
  );
}
