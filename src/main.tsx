import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Toaster, toast } from "sonner";
import "./styles/globals.css";
import { useSessionsStore } from "@/state/sessionsStore";
import { useSettingsStore } from "@/state/settingsStore";
import { getFileSink, isFilePersistActive } from "@/lib/markdown/sink";
import { recoverFromDisk } from "@/lib/markdown/parser";
import { appendMessage, createSession, recordUsage } from "@/lib/db/repos";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <Toaster richColors position="bottom-left" />
  </React.StrictMode>,
);

// استرجاع جلسات القرص عند الإقلاع (المهمة 13). التحقق من Tauri يمر عبر منشّط الملفات:
// بلا setFileSink من وضع سطح المكتب (المهمة 14 ستضبط الجذر وتنصّب tauriSink) يبقى وضع الويب
// آمنًا بلا استرجاع، والاسترجاع نفسه لا يمنع تشغيل التطبيق عند أي فشل.
void (async () => {
  try {
    await Promise.all([useSettingsStore.getState().load(), useSessionsStore.getState().load()]);
    const { sessionRootDir } = useSettingsStore.getState();
    if (!isFilePersistActive() || !sessionRootDir) return;
    if (useSessionsStore.getState().sessions.length !== 0) return;
    const restored = await recoverFromDisk(getFileSink(), sessionRootDir);
    for (const r of restored) {
      await createSession(r.meta);
      for (const m of r.messages) await appendMessage(m);
      for (const u of r.usageEvents) await recordUsage(u);
    }
    if (restored.length) {
      await useSessionsStore.getState().load();
      toast.success(`استُرجعت ${restored.length} جلسة من القرص`);
    }
  } catch { /* الاسترجاع عند الإقلاع لا يعطّل تشغيل التطبيق */ }
})();
