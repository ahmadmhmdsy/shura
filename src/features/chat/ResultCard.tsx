import { useState } from "react";
import { Copy, RotateCcw, Square, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "./Markdown";
import { PROVIDERS } from "@/lib/providers/registry";
import { ar } from "@/i18n/ar";
import type { ChatMessage } from "@/types";

export interface ResultCardProps {
  msg: ChatMessage; customPrompt: string | null; horizontal: boolean;
  onStop(targetId: string): void; onRetry(targetId: string): void;
}

export function ResultCard({ msg, customPrompt, horizontal, onStop, onRetry }: ResultCardProps) {
  const [openCustom, setOpenCustom] = useState(false);
  const label = msg.providerId ? PROVIDERS[msg.providerId].label : "—";
  const usage = msg.usage;
  return (
    <div className={"border border-sura-border rounded-lg bg-sura-bg flex flex-col " + (horizontal ? "min-w-80 flex-1" : "w-full")}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-sura-border">
        <Badge variant="secondary">{label}</Badge>
        <span className="text-xs text-sura-muted truncate">{msg.modelId}</span>
        <div className="flex-1" />
        {msg.status === "streaming" && <span className="text-xs text-sura-muted animate-pulse">{ar.streaming}</span>}
        {msg.status === "stopped" && <span className="text-xs text-sura-warn">{ar.stopped}</span>}
        <Button size="icon" variant="ghost" aria-label="نسخ" onClick={() => void navigator.clipboard.writeText(msg.text)}><Copy className="size-3.5" /></Button>
        {msg.status === "streaming"
          ? <Button size="icon" variant="ghost" aria-label={ar.stop} onClick={() => onStop(msg.targetId!)}><Square className="size-3.5" /></Button>
          : <Button size="icon" variant="ghost" aria-label="إعادة" onClick={() => onRetry(msg.targetId!)}><RotateCcw className="size-3.5" /></Button>}
      </div>
      {customPrompt && (
        <div className="border-b border-sura-border px-3 py-1.5">
          <button className="text-xs text-sura-muted flex items-center gap-1" onClick={() => setOpenCustom(!openCustom)}>
            <ChevronDown className={"size-3.5 transition-transform " + (openCustom ? "" : "-rotate-90")} /> السؤال المخصص
          </button>
          {openCustom && <p className="text-xs mt-1 whitespace-pre-wrap">{customPrompt}</p>}
        </div>
      )}
      <div className="p-3 flex-1 overflow-y-auto">
        {msg.status === "error" ? <p className="text-sura-danger text-sm">{msg.error}</p> : <Markdown text={msg.text} />}
      </div>
      <div className="px-3 py-1.5 border-t border-sura-border text-[11px] text-sura-muted flex gap-3">
        {usage ? <><span>↓ {usage.inputTokens}</span><span>↑ {usage.outputTokens}</span><span>كاش {usage.cachedInputTokens}</span><span>{usage.costUSD == null ? "—" : "$" + usage.costUSD.toFixed(6)}</span></> : <span>—</span>}
      </div>
    </div>
  );
}
