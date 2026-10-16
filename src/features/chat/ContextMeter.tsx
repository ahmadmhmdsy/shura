import { contextLevel, contextPercent } from "@/lib/tokens/estimate";
import { useUiText } from "@/i18n";
import type { ContextMode } from "@/types";

export function ContextMeter({ used, limit, assumed = false, contextMode }: { used: number; limit: number | null | undefined; assumed?: boolean; contextMode: ContextMode }) {
  // [T2.5/NL-02] الحد يأتي من resolveContextLimit: البوابة والمقياس رقم واحد، فلا يُرفض السؤال
  // بلا حركة مقياس تشرحه. وحين يكون الحد مفترضًا (لا نشر للمزود) تظهر علامة «~» حتى لا يُقرأ
  // الرقم كحد منشور. غياب الهدف كليًا يبقى علامة جهل صادقة.
  const { t } = useUiText();
  const known = typeof limit === "number" && Number.isFinite(limit) && limit > 0;
  const assumedKnown = known && assumed;
  const pct = known ? contextPercent(used, limit as number) : null;
  const lvl = known ? contextLevel(used, limit as number) : "ok";
  const color = known && lvl === "danger" ? "text-sura-danger" : known && lvl === "warn" ? "text-sura-warn" : "text-sura-muted";
  return (
    <div className={"flex items-center gap-1 text-xs " + color} title={known ? t("chat.contextOf") + (assumedKnown ? t("chat.contextAssumed") : t("chat.contextEstimated")) : t("chat.contextUnknown")}>
      <span>📊</span>
      {pct !== null ? <span>{assumedKnown ? t("chat.contextAssumedMark") : ""}{pct}%</span> : <span>{t("chat.contextUnknownMark")}</span>}
      {contextMode === "stateless" && <span>{t("chat.statelessCompare")}</span>}
    </div>
  );
}
