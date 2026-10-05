import { useEffect } from "react";
import { ar } from "@/i18n/ar";
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
  const shortcuts: Shortcut[] = [
    {
      key: "k",
      ctrl: true,
      action: () => {
        const searchInput = document.querySelector<HTMLInputElement>('input[aria-label="ابحث في الجلسات…"]');
        searchInput?.focus();
      },
      description: ar.shortcutSearch,
    },
    {
      key: "n",
      ctrl: true,
      action: () => {
        safeExecute(() => { useSessionsStore.getState().newSession(); incrementSessionCount(); logger.info("New session created"); }, "newSession");
      },
      description: ar.shortcutNewSession,
    },
    {
      key: "s",
      ctrl: true,
      shift: true,
      action: () => onOpenSettings(),
      description: ar.shortcutSettings,
    },
    {
      key: "Escape",
      action: () => {
        window.dispatchEvent(new CustomEvent("shura:stop-generation"));
      },
      description: ar.shortcutStop,
      when: () => {
        const target = document.activeElement;
        return target?.tagName !== "INPUT" && target?.tagName !== "TEXTAREA";
      },
    },
    {
      key: "?",
      action: () => onShowHelp(),
      description: ar.shortcutHelp,
      when: () => {
        const target = document.activeElement;
        return target?.tagName !== "INPUT" && target?.tagName !== "TEXTAREA";
      },
    },
    {
      key: ",",
      ctrl: true,
      action: () => onOpenSettings(),
      description: ar.shortcutSettings,
    },
    {
      key: "/",
      ctrl: true,
      action: () => onToggleTheme(),
      description: ar.shortcutToggleTheme,
    },
  ];

  useEffect(() => {
    return registerShortcuts(shortcuts);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- register once; handlers are stable
  }, []);

  return shortcuts;
}
