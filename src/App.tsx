import { useState } from "react";
import { Sidebar } from "@/features/sessions/Sidebar";
import { SettingsScreen } from "@/features/settings/SettingsScreen";
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
        // إعادة تركيب حصرية عند تغيير الجلسة: كل حالة المؤلف/التمرة في ChatScreen تُعاد من الصفر، لا سيلان من جلسة إلى أخرى
        ? <ChatScreen key={currentSession.id} session={currentSession} />
        : <div className="flex-1 grid place-items-center text-sura-muted">{ar.newSession + " ← من السايدبار"}</div>}
      {showSettings && <SettingsScreen onClose={() => setShowSettings(false)} />}
    </div>
  );
}
