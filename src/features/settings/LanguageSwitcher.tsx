import { Languages } from "lucide-react";
import { LOCALES, useUiText, type Locale, type ResourceKey } from "@/i18n";
import { useSettingsStore } from "@/state/settingsStore";

/** Each locale names itself in its own language, so the picker reads either way. */
const LANGUAGE_LABEL: Record<Locale, ResourceKey> = {
  en: "language.english",
  ar: "language.arabic",
};

/**
 * Language picker (locked decision D4): rendered in Settings and in the top bar.
 *
 * The locale is applied to UiText immediately so the UI flips at once, then persisted
 * through the settings store; a failed write rolls the visible locale back.
 */
export function LanguageSwitcher({ variant = "field" }: { variant?: "field" | "compact" }) {
  const ui = useUiText();
  const language = useSettingsStore((state) => state.language);
  const setLanguage = useSettingsStore((state) => state.setLanguage);

  const change = (next: Locale) => {
    const previous = ui.getLocale();
    if (next === previous) return;
    ui.setLocale(next);
    void setLanguage(next).catch(() => ui.setLocale(previous));
  };

  const compact = variant === "compact";
  return (
    <label
      className={
        compact
          ? "flex items-center gap-1"
          : "flex items-center gap-2 text-[var(--sura-text-body-sm)]"
      }
    >
      <Languages className="size-4 shrink-0" aria-hidden="true" />
      <span className={compact ? "sr-only" : "text-[var(--sura-text-secondary)]"}>
        {ui.t("language.label")}
      </span>
      <select
        aria-label={ui.t("language.label")}
        value={language}
        onChange={(event) => change(event.target.value as Locale)}
        className={
          compact
            ? "cursor-pointer bg-transparent text-[var(--sura-text-body-sm)] text-[var(--sura-text-tertiary)] outline-none hover:text-[var(--sura-text-primary)] focus-visible:text-[var(--sura-text-primary)]"
            : "cursor-pointer rounded-[var(--sura-radius-sm)] border border-[var(--sura-border-primary)] bg-[var(--sura-surface-secondary)] px-2 py-1 text-[var(--sura-text-body-sm)] text-[var(--sura-text-primary)] outline-none focus-visible:border-[var(--sura-border-accent)]"
        }
      >
        {LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {ui.t(LANGUAGE_LABEL[locale])}
          </option>
        ))}
      </select>
    </label>
  );
}
