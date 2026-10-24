import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "./Markdown";
import { uiText, useUiText } from "@/i18n";
import type { ChatMessage } from "@/types";
import { messageErrorText } from "@/lib/chat/messageError";
import { formatCost } from "@/lib/usage/cost";

async function copyText(text: string): Promise<void> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      throw new Error("clipboard unavailable");
    }
    await navigator.clipboard.writeText(text);
  } catch {
    toast.error(uiText.t("chat.copyError"));
  }
}

// نسخة من ResultCard لرسائل kind="synthesis": الشارة «خلاصة النموذج الأساسي» بـ variant="default"
// وبلا أزرار الإيقاف/إعادة المحاولة — رسالة synthesis بلا targetId فلا مسار إيقاف ولا إعادة لها.
export function SummaryCard({ msg, horizontal }: { msg: ChatMessage; horizontal: boolean }) {
  const { t, formatNumber } = useUiText();
  const usage = msg.usage;
  return (
    <div className={"border border-sura-border rounded-lg bg-sura-bg flex flex-col " + (horizontal ? "min-w-80 flex-1" : "w-full")}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-sura-border">
        <Badge variant="default">{t("chat.synthesisBadge")}</Badge>
        <span className="text-xs text-sura-muted truncate">{msg.modelId}</span>
        <div className="flex-1" />
        <Button size="icon" variant="ghost" aria-label={t("chat.copy")} onClick={() => { void copyText(msg.text); }}><Copy className="size-3.5" /></Button>
      </div>
      <div role="status" aria-live="polite" aria-busy={msg.status === "streaming"} className="p-3 flex-1 overflow-y-auto">
        {msg.status === "streaming" && <span className="block text-xs text-sura-muted animate-pulse">{t("chat.streaming")}</span>}
        {msg.status === "stopped" && <span className="block text-xs text-sura-warn">{t("chat.stopped")}</span>}
        {msg.status === "truncated" && <span className="block text-xs text-sura-warn">{t("chat.truncated")}</span>}
        {msg.status === "error" && msg.error && <p className="text-sura-danger text-sm">{messageErrorText(t, msg.error)}</p>}
        {msg.text && <Markdown text={msg.text} />}
        {msg.sidecarWarning && <p className="mt-2 text-xs text-sura-warn whitespace-pre-wrap">{msg.sidecarWarning}</p>}
      </div>
      <div className="px-3 py-1.5 border-t border-sura-border text-[length:var(--sura-text-mini)] text-sura-muted flex gap-3">
        {usage ? <><span>↓ {usage.inputTokens}</span><span>↑ {usage.outputTokens}</span><span>{t("chat.cachedTokens")} {usage.cachedInputTokens}</span>{usage.cacheWriteInputTokens ? <span>{t("chat.cacheWriteTokens")} {usage.cacheWriteInputTokens}</span> : null}<span>{formatCost(usage.costUSD, t("common.noValue"), formatNumber)}</span></> : <span>{t("common.noValue")}</span>}
      </div>
    </div>
  );
}
