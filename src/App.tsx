import { useEffect, useState, useCallback } from "react";
import { Menu, X, Sun, Moon, HelpCircle, Plus } from "lucide-react";
import { Sidebar } from "@/features/sessions/Sidebar";
import { SettingsScreen } from "@/features/settings/SettingsScreen";
import { ChatScreen } from "@/features/chat/ChatScreen";
import { useSessionsStore } from "@/state/sessionsStore";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ar } from "@/i18n/ar";
import { StatusAnnouncer } from "@/features/chat/StatusAnnouncer";
import { initAppLogging, logger, safeExecute, incrementSessionCount } from "@/lib/logging";

// Theme management
type Theme = "dark" | "light";
function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = localStorage.getItem("shura-theme");
  if (stored === "light" || stored === "dark") return stored;
  return "dark";
}

// Onboarding state
function getOnboardingSeen(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem("shura-onboarding-seen") === "true";
}

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => !getOnboardingSeen());
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  // Initialize logging and metrics
  useEffect(() => {
    initAppLogging();
    logger.info("App component mounted");
  }, []);
  const currentSession = useSessionsStore((s) => (s.currentId ? s.sessions.find((x) => x.id === s.currentId) ?? null : null));

  // Apply theme
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("shura-theme", theme);
  }, [theme]);

  // Mark onboarding as seen when closed
  const closeOnboarding = useCallback(() => {
    setShowOnboarding(false);
    localStorage.setItem("shura-onboarding-seen", "true");
  }, []);

  // Close mobile nav on escape
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setNavOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Ctrl/Cmd+N: New session
      if ((event.ctrlKey || event.metaKey) && event.key === "n") {
        event.preventDefault();
        safeExecute(() => { useSessionsStore.getState().newSession(); incrementSessionCount(); logger.info("New session created"); }, "newSession");
      }
      // Ctrl/Cmd+K: Focus search
      if ((event.ctrlKey || event.metaKey) && event.key === "k") {
        event.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>('input[aria-label="ابحث في الجلسات…"]');
        searchInput?.focus();
      }
      // Ctrl/Cmd+,: Open settings
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        setShowSettings(true);
      }
      // Ctrl/Cmd+/: Toggle theme
      if ((event.ctrlKey || event.metaKey) && event.key === "/") {
        event.preventDefault();
        setTheme(t => t === "dark" ? "light" : "dark");
      }
      // ?: Show help
      if (event.key === "?" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const target = event.target as HTMLElement;
        if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
          event.preventDefault();
          setShowHelp(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
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

      {/* Onboarding Dialog */}
      <Dialog open={showOnboarding} onOpenChange={(v) => { if (!v) { closeOnboarding(); setOnboardingStep(0); } }}>
        <DialogContent className="max-w-md" dir="rtl" closeLabel={ar.onboardingSkip}>
          <DialogHeader>
            <DialogTitle>{ar.onboardingTitle}</DialogTitle>
            <DialogDescription className="sr-only">{ar.whatIsShuraDesc}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {onboardingStep === 0 && (
              <div className="space-y-2">
                <h3 className="text-[var(--sura-text-h4)] font-[var(--sura-font-semibold)] text-[var(--sura-text-primary)]">{ar.onboardingStep1Title}</h3>
                <p className="text-[var(--sura-text-body-sm)] text-[var(--sura-text-secondary)]">{ar.onboardingStep1Desc}</p>
              </div>
            )}
            {onboardingStep === 1 && (
              <div className="space-y-2">
                <h3 className="text-[var(--sura-text-h4)] font-[var(--sura-font-semibold)] text-[var(--sura-text-primary)]">{ar.onboardingStep2Title}</h3>
                <p className="text-[var(--sura-text-body-sm)] text-[var(--sura-text-secondary)]">{ar.onboardingStep2Desc}</p>
              </div>
            )}
            {onboardingStep === 2 && (
              <div className="space-y-2">
                <h3 className="text-[var(--sura-text-h4)] font-[var(--sura-font-semibold)] text-[var(--sura-text-primary)]">{ar.onboardingStep3Title}</h3>
                <p className="text-[var(--sura-text-body-sm)] text-[var(--sura-text-secondary)]">{ar.onboardingStep3Desc}</p>
              </div>
            )}
            {/* Step indicators */}
            <div className="flex justify-center gap-2 pt-2" aria-label={"الخطوة " + (onboardingStep + 1) + " من 3"}>
              {[0, 1, 2].map((i) => (
                <button
                  key={i}
                  type="button"
                  className={"size-2 rounded-[var(--sura-radius-full)] transition-colors " + (i === onboardingStep ? "bg-[var(--sura-accent-primary)]" : "bg-[var(--sura-border-primary)]")}
                  onClick={() => setOnboardingStep(i)}
                  aria-label={"الخطوة " + (i + 1)}
                  aria-current={i === onboardingStep ? "true" : undefined}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-between items-center">
            <div className="flex gap-2">
              <Button variant="ghost" onClick={closeOnboarding}>{ar.onboardingSkip}</Button>
              <Button variant="outline" onClick={closeOnboarding}>{ar.onboardingTryExample}</Button>
            </div>
            <div className="flex gap-2">
              {onboardingStep > 0 && (
                <Button variant="ghost" onClick={() => setOnboardingStep(onboardingStep - 1)}>{ar.onboardingBack}</Button>
              )}
              {onboardingStep < 2
                ? <Button onClick={() => setOnboardingStep(onboardingStep + 1)}>{ar.onboardingNext}</Button>
                : <Button onClick={() => { closeOnboarding(); setOnboardingStep(0); }}>{ar.onboardingDone}</Button>}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Help Dialog */}
      <Dialog open={showHelp} onOpenChange={setShowHelp}>
        <DialogContent className="max-w-md" dir="rtl" closeLabel="إغلاق">
          <DialogHeader>
            <DialogTitle>{ar.whatIsShura}</DialogTitle>
            <DialogDescription className="sr-only">{ar.whatIsShuraDesc}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4 text-[var(--sura-text-body-sm)] text-[var(--sura-text-secondary)]">
            <p>{ar.whatIsShuraDesc}</p>
            <div className="space-y-2">
              <h4 className="text-[var(--sura-text-body-sm)] font-[var(--sura-font-semibold)] text-[var(--sura-text-primary)]">{ar.whatIsShuraTargets}</h4>
              <p>{ar.whatIsShuraTargetsDesc}</p>
            </div>
            <div className="space-y-2">
              <h4 className="text-[var(--sura-text-body-sm)] font-[var(--sura-font-semibold)] text-[var(--sura-text-primary)]">{ar.whatIsShuraSync}</h4>
              <p>{ar.whatIsShuraSyncDesc}</p>
            </div>
            <div className="space-y-2">
              <h4 className="text-[var(--sura-text-body-sm)] font-[var(--sura-font-semibold)] text-[var(--sura-text-primary)]">{ar.whatIsShuraContext}</h4>
              <p>{ar.whatIsShuraContextDesc}</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <StatusAnnouncer />
    </div>
  );
}

function MessageSquare(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
