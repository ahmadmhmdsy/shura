import { useEffect, useState, useCallback } from "react";
import { Menu, X, Sun, Moon, HelpCircle, Plus, MessageSquare } from "lucide-react";
import { Sidebar } from "@/features/sessions/Sidebar";
import { SettingsScreen } from "@/features/settings/SettingsScreen";
import { ChatScreen } from "@/features/chat/ChatScreen";
import { useSessionsStore } from "@/state/sessionsStore";
import { Button } from "@/components/ui/button";
import { ar } from "@/i18n/ar";
import { StatusAnnouncer } from "@/features/chat/StatusAnnouncer";
import { initAppLogging, logger, incrementSessionCount } from "@/lib/logging";
import { ShortcutHelpDialog } from "@/features/keyboard/ShortcutHelpDialog";
import { useAppShortcuts } from "@/features/keyboard/useAppShortcuts";
import { OnboardingDialog, hasSeenOnboarding, markOnboardingSeen } from "@/features/onboarding/OnboardingDialog";
import { useTheme } from "@/lib/theme/useTheme";

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => !hasSeenOnboarding());
  const [showHelp, setShowHelp] = useState(false);
  const { theme, toggleTheme } = useTheme();

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
    <div className="flex h-full" dir="rtl">
      {/* Skip navigation link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 focus:px-3 focus:py-2 focus:bg-[var(--sura-accent-primary)] focus:text-[var(--sura-accent-foreground)] focus:rounded-[var(--sura-radius-md)]"
      >
        تخطي إلى المحتوى الرئيسي
      </a>

      {/* Top bar with actions */}
      <div className="fixed top-2 start-2 z-50 flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={theme === "dark" ? ar.lightTheme : ar.darkTheme}
          onClick={toggleTheme}
          className="text-[var(--sura-text-tertiary)] hover:text-[var(--sura-text-primary)] hover:bg-[var(--sura-hover)]"
        >
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={ar.whatIsShura}
          onClick={() => setShowHelp(true)}
          className="text-[var(--sura-text-tertiary)] hover:text-[var(--sura-text-primary)] hover:bg-[var(--sura-hover)]"
        >
          <HelpCircle className="size-4" />
        </Button>
      </div>

      {/* Mobile nav toggle */}
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={navOpen ? "إغلاق القائمة" : "القائمة"}
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
      <main id="main-content" className="min-w-0 flex-1" onClick={() => { if (navOpen) setNavOpen(false); }}>
        {currentSession ? (
          <ChatScreen key={currentSession.id} session={currentSession} onOpenSettings={() => setShowSettings(true)} />
        ) : (
          <div className="grid h-full place-items-center p-8 text-center">
            <div className="flex max-w-md flex-col items-center gap-4">
              <div className="flex size-16 items-center justify-center rounded-[var(--sura-radius-2xl)] bg-[var(--sura-accent-muted)]">
                <MessageSquare className="size-8 text-[var(--sura-accent-primary)]" />
              </div>
              <div className="space-y-2">
                <h2 className="text-[var(--sura-text-h2)] font-[var(--sura-font-semibold)] text-[var(--sura-text-primary)]">
                  {ar.emptyStateTitle}
                </h2>
                <p className="text-[var(--sura-text-body)] text-[var(--sura-text-secondary)]">
                  {ar.emptyStateDesc}
                </p>
              </div>
              <Button
                onClick={() => { useSessionsStore.getState().newSession(); incrementSessionCount(); }}
                className="gap-2"
              >
                <Plus className="size-4" />
                {ar.newSession}
              </Button>
            </div>
          </div>
        )}
      </main>

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
