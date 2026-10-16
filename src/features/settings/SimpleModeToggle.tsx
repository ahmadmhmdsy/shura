import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/state/settingsStore";
import { useUiText } from "@/i18n";

export function SimpleModeToggle() {
  const { t } = useUiText();
  const { simpleMode, setSimpleMode } = useSettingsStore();
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded border border-sura-border bg-sura-panel p-3">
      <div>
        <p className="text-sm font-medium text-sura-foreground">{t("chat.simpleMode")}</p>
        <p className="text-xs text-sura-muted">{t("settings.simpleModeDesc")}</p>
      </div>
      <Switch
        checked={simpleMode}
        onCheckedChange={(v) => void setSimpleMode(v)}
        aria-label={t("chat.simpleMode")}
      />
    </div>
  );
}
