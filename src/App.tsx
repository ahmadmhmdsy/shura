import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Sidebar } from "@/features/sessions/Sidebar";
import { SettingsScreen } from "@/features/settings/SettingsScreen";
import { ChatScreen } from "@/features/chat/ChatScreen";
import { useSessionsStore } from "@/state/sessionsStore";
import { Button } from "@/components/ui/button";
import { ar } from "@/i18n/ar";
import { StatusAnnouncer } from "@/features/chat/StatusAnnouncer";

// The intended dark theme must be on the root element before the first paint, not
// applied after React mounts.
document.documentElement.classList.add("dark");

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const currentSession = useSessionsStore((s) => (s.currentId ? s.sessions.find((x) => x.id === s.currentId) ?? null : null));

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setNavOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  return (
    <div className="h-full flex" dir="rtl">
      {/* Below md the sidebar is an overlay drawer driven by this toggle. */}
      <Button
        variant="outline"
        size="icon"
        aria-label={navOpen ? "إغلاق القائمة" : "القائمة"}
        aria-expanded={navOpen}
        aria-controls="shura-sidebar"
        className="md:hidden fixed top-2 end-2 z-40"
        onClick={() => setNavOpen((open) => !open)}
      >
        {navOpen ? <X className="size-4" /> : <Menu className="size-4" />}
      </Button>

      <div className={"shrink-0 " + (navOpen ? "fixed inset-0 z-30 bg-black/50 md:static md:bg-transparent" : "hidden md:block")}>
        <div id="shura-sidebar" className="w-full md:w-64 h-full">
          <Sidebar onOpenSettings={() => { setShowSettings(true); setNavOpen(false); }} />
        </div>
      </div>

      <main className="min-w-0 flex-1" onClick={() => { if (navOpen) setNavOpen(false); }}>
        {currentSession
          // إعادة تركيب حصرية عند تغيير الجلسة: كل حالة المؤلف/التمرة في ChatScreen تُعاد من الصفر، لا سيلان من جلسة إلى أخرى
          ? <ChatScreen key={currentSession.id} session={currentSession} />
          : <div className="flex-1 grid place-items-center text-sura-muted p-4 text-center">{ar.newSession + " ← من السايدبار"}</div>}
      </main>

      <StatusAnnouncer />

      {showSettings && <SettingsScreen onClose={() => setShowSettings(false)} />}
    </div>
  );
}