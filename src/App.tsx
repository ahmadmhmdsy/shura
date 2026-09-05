import { useState } from "react";
import { Sidebar } from "@/features/sessions/Sidebar";
import { ChatScreen } from "@/features/chat/ChatScreen";

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  return (
    <div className="h-full flex" dir="rtl">
      <Sidebar onOpenSettings={() => setShowSettings(true)} />
      <ChatScreen />
      {showSettings && <div className="fixed inset-0 bg-black/50 grid place-items-center" onClick={() => setShowSettings(false)}>
        <div className="bg-sura-panel border border-sura-border rounded p-6" onClick={(e) => e.stopPropagation()}>شاشة الإعدادات — المهمة 12</div>
      </div>}
    </div>
  );
}
