import { useEffect, useState, useCallback } from "react";
import { Menu, X, Sun, Moon, HelpCircle, Plus, MessageSquare } from "lucide-react";
import { Sidebar } from "@/features/sessions/Sidebar";
import { SettingsScreen } from "@/features/settings/SettingsScreen";
import { ChatScreen } from "@/features/chat/ChatScreen";
import { useSessionsStore } from "@/state/sessionsStore";
import { Button } from "@/components/ui/button";
import { useUiText } from "@/i18n";
import { StatusAnnouncer } from "@/features/chat/StatusAnnouncer";
import { initAppLogging, logger, incrementSessionCount } from "@/lib/logging";
import { ShortcutHelpDialog } from "@/features/keyboard/ShortcutHelpDialog";
import { useAppShortcuts } from "@/features/keyboard/useAppShortcuts";
import { OnboardingDialog, hasSeenOnboarding, markOnboardingSeen } from "@/features/onboarding/OnboardingDialog";
import { useTheme } from "@/lib/theme/useTheme";
import { LanguageSwitcher } from "@/features/settings/LanguageSwitcher";

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => !hasSeenOnboarding());
  const [showHelp, setShowHelp] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { t } = useUiText();

  // Initialize logging and metrics
  useEffect(() => {
    initAppLogging();
    logger.info("App component mounted");
  }, []);
  const currentSession = useSessionsStore((s) => (s.currentId ? s.sessions.find((x) => x.id === s.currentId) ?? null : null));

  // Mark onboarding as seen when closed
  const closeOnboarding = useCallback(() => {
    setShowOnboarding(false);
    markOnboardingSeen();
  }, []);

  // Close mobile nav on escape
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setNavOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  // Global keyboard shortcuts
  const shortcuts = useAppShortcuts({
    onOpenSettings: () => setShowSettings(true),
    onShowHelp: () => setShowHelp(true),
    onToggleTheme: toggleTheme,
  });

  return (
    <div className="flex h-full">
      {/* Skip navigation link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 focus:px-3 focus:py-2 focus:bg-[var(--sura-accent-primary)] focus:text-[var(--sura-accent-foreground)] focus:rounded-[var(--sura-radius-md)]"
      >
        {t("app.skipToContent")}
      </a>

      {/* Top bar with actions */}
      <header className="fixed top-2 start-2 z-50 flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={theme === "dark" ? t("theme.light") : t("theme.dark")}
          onClick={toggleTheme}
          className="text-[var(--sura-text-tertiary)] hover:text-[var(--sura-text-primary)] hover:bg-[var(--sura-hover)]"
        >
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("onboarding.whatIsShura")}
          onClick={() => setShowHelp(true)}
          className="text-[var(--sura-text-tertiary)] hover:text-[var(--sura-text-primary)] hover:bg-[var(--sura-hover)]"
        >
          <HelpCircle className="size-4" />
        </Button>
        <LanguageSwitcher variant="compact" />
      </header>

      {/* Mobile nav toggle */}
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={navOpen ? t("app.closeMenu") : t("app.openMenu")}
        aria-expanded={navOpen}
        aria-controls="shura-sidebar"
        className="md:hidden fixed top-2 end-2 z-40"
        onClick={() => setNavOpen((open) => !open)}
      >
        {navOpen ? <X className="size-4" /> : <Menu className="size-4" />}
      </Button>

      {/* Sidebar */}
      <div className={"shrink-0 " + (navOpen ? "fixed inset-0 z-30 bg-[var(--sura-surface-overlay)] md:static md:bg-transparent" : "hidden md:block")}>
        <div id="shura-sidebar" className="h-full w-full md:w-64">
          <Sidebar onOpenSettings={() => { setShowSettings(true); setNavOpen(false); }} />
        </div>
      </div>

      {/* Main content */}
      <div id="main-content" className="min-w-0 flex-1" onClick={() => { if (navOpen) setNavOpen(false); }}>
        {/* [T5.3-f2] Both branches must expose a main landmark. ChatScreen renders <main>, and the
            empty state is the only other screen, so it does too - the branches are exclusive, so two
            landmarks never coexist. axe's landmark-one-main is best-practice only, hence this comment. */}
        {currentSession ? (
          <ChatScreen key={currentSession.id} session={currentSession} autoFocusComposer={!showOnboarding} onOpenSettings={() => { setShowSettings(true); }} />
        ) : (
          <main className="grid h-full place-items-center p-8 text-center">
            <div className="flex max-w-md flex-col items-center gap-4">
              <div className="flex size-16 items-center justify-center rounded-[var(--sura-radius-2xl)] bg-[var(--sura-accent-muted)]">
                <MessageSquare className="size-8 text-[var(--sura-accent-primary)]" />
              </div>
              <div className="space-y-2">
                <h2 className="text-[var(--sura-text-h2)] font-[var(--sura-font-semibold)] text-[var(--sura-text-primary)]">
                  {t("chat.emptyStateTitle")}
                </h2>
                <p className="text-[var(--sura-text-body)] text-[var(--sura-text-secondary)]">
                  {t("chat.emptyStateDesc")}
                </p>
              </div>
              <Button
                onClick={() => { useSessionsStore.getState().newSession(); incrementSessionCount(); }}
                className="gap-2"
              >
                <Plus className="size-4" />
                {t("app.newSession")}
              </Button>
            </div>
          </main>
        )}
      </div>

      {/* Settings */}
      {showSettings && <SettingsScreen onClose={() => setShowSettings(false)} />}

      {/* Onboarding wizard */}
      <OnboardingDialog open={showOnboarding} onClose={closeOnboarding} />

      {/* Shortcut Help Dialog */}
      <ShortcutHelpDialog open={showHelp} onOpenChange={setShowHelp} shortcuts={shortcuts} />

      <StatusAnnouncer />
    </div>
  );
}
