import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/state/settingsStore";
import { useUiText } from "@/i18n";

/**
 * A composer behaviour rather than a searchable settings section, so it sits beside the
 * simple-mode switch: it is a basic preference that both simple and advanced mode show.
 */
export function ClearCustomsToggle() {
  const { t } = useUiText();
  const clearCustomsOnSend = useSettingsStore((s) => s.clearCustomsOnSend);
  const setClearCustomsOnSend = useSettingsStore((s) => s.setClearCustomsOnSend);
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded border border-sura-border bg-sura-panel p-3">
      <div>
        <p className="text-sm font-medium text-sura-foreground">{t("settings.clearCustomsOnSend")}</p>
        <p className="text-xs text-sura-muted">{t("settings.clearCustomsOnSendDesc")}</p>
      </div>
      <Switch
        checked={clearCustomsOnSend}
        onCheckedChange={(v) => void setClearCustomsOnSend(v)}
        aria-label={t("settings.clearCustomsOnSend")}
      />
    </div>
  );
}
