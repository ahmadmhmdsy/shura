import { contextLevel, contextPercent } from "@/lib/tokens/estimate";
import { ar } from "@/i18n/ar";

export function ContextMeter({ used, limit }: { used: number; limit: number }) {
  const pct = contextPercent(used, limit);
  const lvl = contextLevel(used, limit);
  const color = lvl === "danger" ? "text-sura-danger" : lvl === "warn" ? "text-sura-warn" : "text-sura-muted";
  return (
    <div className={"flex items-center gap-1 text-xs " + color} title={ar.contextOf + " (تقديري)"}>
      <span>📊</span><span>{pct}%</span>
    </div>
  );
}
