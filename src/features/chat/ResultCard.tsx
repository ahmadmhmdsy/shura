import { useState } from "react";
import { Copy, RotateCcw, Square, ChevronDown, AlertCircle, Trophy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "./Markdown";
import { PROVIDERS } from "@/lib/providers/registry";
import { uiText, useUiText } from "@/i18n";
import type { ChatMessage } from "@/types";
import { messageErrorText } from "@/lib/chat/messageError";
import { formatCost } from "@/lib/usage/cost";

// Model-specific color coding for visual distinction
const PROVIDER_COLORS: Record<string, { border: string; bg: string; accent: string }> = {
  openrouter: { border: "border-l-emerald-500/50", bg: "bg-emerald-500/5", accent: "text-emerald-500" },
  anthropic: { border: "border-l-amber-500/50", bg: "bg-amber-500/5", accent: "text-amber-500" },
  openai: { border: "border-l-sky-500/50", bg: "bg-sky-500/5", accent: "text-sky-500" },
  google: { border: "border-l-rose-500/50", bg: "bg-rose-500/5", accent: "text-rose-500" },
  groq: { border: "border-l-violet-500/50", bg: "bg-violet-500/5", accent: "text-violet-500" },
  mistral: { border: "border-l-orange-500/50", bg: "bg-orange-500/5", accent: "text-orange-500" },
  deepseek: { border: "border-l-cyan-500/50", bg: "bg-cyan-500/5", accent: "text-cyan-500" },
};

function getProviderStyle(providerId: string | undefined) {
  if (!providerId) return { border: "border-l-sura-border", bg: "", accent: "text-sura-muted" };
  return PROVIDER_COLORS[providerId] ?? { border: "border-l-sura-border", bg: "", accent: "text-sura-muted" };
}

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

export interface ResultCardProps {
  msg: ChatMessage; customPrompt: string | null; horizontal: boolean;
  onStop(message: ChatMessage): void; onRetry(message: ChatMessage): void;
  disabled?: boolean;
  stopDisabled?: boolean | ((message: ChatMessage) => boolean);
  isBestAnswer?: boolean;
  onMarkBest?: () => void;
}

export function ResultCard({ msg, customPrompt, horizontal, onStop, onRetry, disabled = false, stopDisabled = false, isBestAnswer = false, onMarkBest }: ResultCardProps) {
  const { t, formatNumber } = useUiText();
  const cardStopDisabled = typeof stopDisabled === "function" ? stopDisabled(msg) : stopDisabled;
  const [openCustom, setOpenCustom] = useState(false);
  const label = msg.providerId ? PROVIDERS[msg.providerId].label : t("common.noValue");
  const usage = msg.usage;
  const providerStyle = getProviderStyle(msg.providerId);
  return (
    <div className={"border border-sura-border border-l-4 " + providerStyle.border + " " + providerStyle.bg + " rounded-lg flex flex-col " + (horizontal ? "min-w-80 flex-1" : "w-full")}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-sura-border">
        <div className={"size-2 rounded-full " + providerStyle.accent + " bg-current"} />
        <Badge variant="secondary">{label}</Badge>
        <span className="text-xs text-sura-muted truncate">{msg.modelId}</span>
        {isBestAnswer && <Badge className="gap-1"><Trophy className="size-3" /> {t("chat.bestAnswer")}</Badge>}
        <div className="flex-1" />
        {onMarkBest && (
          <Button size="icon" variant="ghost" aria-label={t("chat.bestAnswer")} aria-pressed={isBestAnswer} onClick={onMarkBest} className={isBestAnswer ? "text-sura-accent" : ""}>
            <Trophy className="size-3.5" />
          </Button>
        )}
        <Button size="icon" variant="ghost" aria-label={t("chat.copy")} onClick={() => { void copyText(msg.text); }}><Copy className="size-3.5" /></Button>
        {msg.status === "streaming"
          ? <Button size="icon" variant="ghost" aria-label={t("chat.stop")} disabled={cardStopDisabled} onClick={() => onStop(msg)}><Square className="size-3.5" /></Button>
          : <Button size="icon" variant="ghost" aria-label={t("chat.retry")} disabled={disabled} onClick={() => onRetry(msg)}><RotateCcw className="size-3.5" /></Button>}
      </div>
      {customPrompt && (
        <div className="border-b border-sura-border px-3 py-1.5">
          <button className="text-xs text-sura-muted flex items-center gap-1" onClick={() => setOpenCustom(!openCustom)}>
            <ChevronDown className={"size-3.5 transition-transform " + (openCustom ? "" : "-rotate-90 rtl:rotate-90")} /> {t("chat.customQuestion")}
          </button>
          {openCustom && <p className="text-xs mt-1 whitespace-pre-wrap">{customPrompt}</p>}
        </div>
      )}
      <div role="status" aria-live="polite" aria-busy={msg.status === "streaming"} className="p-3 flex-1 overflow-y-auto">
        {msg.status === "streaming" && (msg.reasoning
          ? <span className="block text-xs text-sura-muted animate-pulse">{t("chat.reasoning")}</span>
          : <span className="block text-xs text-sura-muted animate-pulse">{t("chat.streaming")}</span>)}
        {msg.status === "stopped" && <span className="block text-xs text-sura-warn">{t("chat.stopped")}</span>}
        {msg.status === "truncated" && <span className="block text-xs text-sura-warn">{t("chat.truncated")}</span>}
        {msg.status === "error" && msg.error && (
          <div className="flex items-start gap-2 rounded border border-sura-danger/40 bg-sura-danger/10 p-2 mb-2" role="alert">
            <AlertCircle className="size-4 text-sura-danger shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sura-danger text-sm">{messageErrorText(t, msg.error)}</p>
              <button
                type="button"
                className="mt-1 text-xs text-sura-muted hover:text-sura-foreground transition-colors flex items-center gap-1"
                onClick={() => onRetry(msg)}
              >
                <RotateCcw className="size-3" /> {t("errors.retryAll")}
              </button>
            </div>
          </div>
        )}
        {msg.text && <Markdown text={msg.text} />}
        {msg.sidecarWarning && <p className="mt-2 text-xs text-sura-warn whitespace-pre-wrap">{msg.sidecarWarning}</p>}
      </div>
      <div className="px-3 py-1.5 border-t border-sura-border text-[length:var(--sura-text-mini)] text-sura-muted flex gap-3">
        {usage ? <><span>↓ {usage.inputTokens}</span><span>↑ {usage.outputTokens}</span><span>{t("chat.cachedTokens")} {usage.cachedInputTokens}</span>{usage.cacheWriteInputTokens ? <span>{t("chat.cacheWriteTokens")} {usage.cacheWriteInputTokens}</span> : null}<span>{formatCost(usage.costUSD, t("common.noValue"), formatNumber)}</span></> : <span>{t("common.noValue")}</span>}
      </div>
    </div>
  );
}
