import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/state/settingsStore";
import { ar } from "@/i18n/ar";

export function SimpleModeToggle() {
  const { simpleMode, setSimpleMode } = useSettingsStore();
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded border border-sura-border bg-sura-panel p-3">
      <div>
        <p className="text-sm font-medium text-sura-foreground">{ar.simpleMode}</p>
        <p className="text-xs text-sura-muted">يخفي الإعدادات المتقدمة ويُثبّت القيم الموصى بها للبحث في المستندات</p>
      </div>
      <Switch
        checked={simpleMode}
        onCheckedChange={(v) => void setSimpleMode(v)}
        aria-label={ar.simpleMode}
      />
    </div>
  );
}
