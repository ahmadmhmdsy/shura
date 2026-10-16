import { useEffect } from "react";
import { useUiText } from "@/i18n";
import { useSessionsStore } from "@/state/sessionsStore";
import { registerShortcuts, type Shortcut } from "@/lib/keyboard/shortcuts";
import { incrementSessionCount, logger, safeExecute } from "@/lib/logging";

export interface AppShortcutHandlers {
  onOpenSettings(): void;
  onShowHelp(): void;
  onToggleTheme(): void;
}

/**
 * Global app-level keyboard shortcuts, registered once on mount and returned so the
 * help dialog can render the same list. Every handler is a stable state setter, a
 * store `getState()` read or a ref-free callback, so one registration cannot go stale.
 */
export function useAppShortcuts({ onOpenSettings, onShowHelp, onToggleTheme }: AppShortcutHandlers): Shortcut[] {
  const { t } = useUiText();
  const shortcuts: Shortcut[] = [
    {
      key: "k",
      ctrl: true,
      action: () => {
        const searchInput = document.querySelector<HTMLInputElement>('input[aria-label="' + t("sessions.search") + '"]');
        searchInput?.focus();
      },
      description: t("keyboard.search"),
    },
    {
      key: "n",
      ctrl: true,
      action: () => {
        safeExecute(() => { useSessionsStore.getState().newSession(); incrementSessionCount(); logger.info("New session created"); }, "newSession");
      },
      description: t("keyboard.newSession"),
    },
    {
      key: "s",
      ctrl: true,
      shift: true,
      action: () => onOpenSettings(),
      description: t("keyboard.settings"),
    },
    {
      key: "Escape",
      action: () => {
        window.dispatchEvent(new CustomEvent("shura:stop-generation"));
      },
      description: t("keyboard.stop"),
      when: () => {
        const target = document.activeElement;
        return target?.tagName !== "INPUT" && target?.tagName !== "TEXTAREA";
      },
    },
    {
      key: "?",
      action: () => onShowHelp(),
      description: t("keyboard.help"),
      when: () => {
        const target = document.activeElement;
        return target?.tagName !== "INPUT" && target?.tagName !== "TEXTAREA";
      },
    },
    {
      key: ",",
      ctrl: true,
      action: () => onOpenSettings(),
      description: t("keyboard.settings"),
    },
    {
      key: "/",
      ctrl: true,
      action: () => onToggleTheme(),
      description: t("keyboard.toggleTheme"),
    },
    // Chat-scoped shortcuts registered in ChatScreen/Composer; listed here only so the
    // help dialog is complete. displayOnly keeps them out of registerShortcuts.
    { key: "Enter", ctrl: true, description: t("keyboard.send"), displayOnly: true },
    { key: "1-9", ctrl: true, description: t("keyboard.focusTarget"), displayOnly: true },
  ];

  useEffect(() => {
    return registerShortcuts(shortcuts);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- register once; handlers are stable
  }, []);

  return shortcuts;
}
