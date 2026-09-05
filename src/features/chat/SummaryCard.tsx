import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "./Markdown";
import { ar } from "@/i18n/ar";
import type { ChatMessage } from "@/types";

// نسخة من ResultCard لرسائل kind="synthesis": الشارة «خلاصة النموذج الأساسي» بـ variant="default"
// وبلا أزرار الإيقاف/إعادة المحاولة — رسالة synthesis بلا targetId فلا مسار إيقاف ولا إعادة لها.
export function SummaryCard({ msg, horizontal }: { msg: ChatMessage; horizontal: boolean }) {
  const usage = msg.usage;
  return (
    <div className={"border border-sura-border rounded-lg bg-sura-bg flex flex-col " + (horizontal ? "min-w-80 flex-1" : "w-full")}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-sura-border">
        <Badge variant="default">خلاصة النموذج الأساسي</Badge>
        <span className="text-xs text-sura-muted truncate">{msg.modelId}</span>
        <div className="flex-1" />
        {msg.status === "streaming" && <span className="text-xs text-sura-muted animate-pulse">{ar.streaming}</span>}
        {msg.status === "stopped" && <span className="text-xs text-sura-warn">{ar.stopped}</span>}
        <Button size="icon" variant="ghost" aria-label="نسخ" onClick={() => void navigator.clipboard.writeText(msg.text)}><Copy className="size-3.5" /></Button>
      </div>
      <div className="p-3 flex-1 overflow-y-auto">
        {msg.status === "error" ? <p className="text-sura-danger text-sm">{msg.error}</p> : <Markdown text={msg.text} />}
      </div>
      <div className="px-3 py-1.5 border-t border-sura-border text-[11px] text-sura-muted flex gap-3">
        {usage ? <><span>↓ {usage.inputTokens}</span><span>↑ {usage.outputTokens}</span><span>كاش {usage.cachedInputTokens}</span><span>{usage.costUSD == null ? "—" : "$" + usage.costUSD.toFixed(6)}</span></> : <span>—</span>}
      </div>
    </div>
  );
}
