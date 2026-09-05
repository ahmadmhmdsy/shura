import { useState } from "react";
import { Sidebar } from "@/features/sessions/Sidebar";
import { ChatScreen } from "@/features/chat/ChatScreen";
import { useSessionsStore } from "@/state/sessionsStore";
import { ar } from "@/i18n/ar";

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const currentSession = useSessionsStore((s) => (s.currentId ? s.sessions.find((x) => x.id === s.currentId) ?? null : null));
  return (
    <div className="h-full flex" dir="rtl">
      <Sidebar onOpenSettings={() => setShowSettings(true)} />
      {currentSession
        ? <ChatScreen session={currentSession} />
        : <div className="flex-1 grid place-items-center text-sura-muted">{ar.newSession + " ← من السايدبار"}</div>}
      {showSettings && <div className="fixed inset-0 bg-black/50 grid place-items-center" onClick={() => setShowSettings(false)}>
        <div className="bg-sura-panel border border-sura-border rounded p-6" onClick={(e) => e.stopPropagation()}>شاشة الإعدادات — المهمة 12</div>
      </div>}
    </div>
  );
}
