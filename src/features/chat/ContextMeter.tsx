import { contextLevel, contextPercent } from "@/lib/tokens/estimate";
import { ar } from "@/i18n/ar";
import type { ContextMode } from "@/types";

export function ContextMeter({ used, limit, contextMode }: { used: number; limit: number | null | undefined; contextMode: ContextMode }) {
  // [المهمة 4] الحد قابل للغبن/المجهول: لا نسبة مولّدة من سجل المزودين أو الافتراضي —
  // غياب البيانات يعرض علامة جهل صادقة بدل توست/نسبة كاذبة.
  const known = typeof limit === "number" && Number.isFinite(limit) && limit > 0;
  const pct = known ? contextPercent(used, limit as number) : null;
  const lvl = known ? contextLevel(used, limit as number) : "ok";
  const color = known && lvl === "danger" ? "text-sura-danger" : known && lvl === "warn" ? "text-sura-warn" : "text-sura-muted";
  return (
    <div className={"flex items-center gap-1 text-xs " + color} title={known ? ar.contextOf + " (تقديري)" : ar.contextUnknown}>
      <span>📊</span>
      {pct !== null ? <span>{pct}%</span> : <span>؟</span>}
      {contextMode === "stateless" && <span>{ar.statelessCompare}</span>}
    </div>
  );
}
