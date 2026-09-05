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
import { isTauri } from "@/lib/transport/transport";
import { bootstrapDesktop } from "@/lib/desktop/bootstrap";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <Toaster richColors position="bottom-left" />
  </React.StrictMode>,
);

// المهمة 14: تهيئة سطح المكتب (نقل بلا CORS عبر plugin-http + حوض ملفات أصلي + جذر الجلسات).
// [انحراف موثق عن نص الخطة] الخطة تطلق bootstrapDesktop كـ IIFE مستقلة متوازية مع استرجاع
// الإقلاع — سباق حقيقي: plugin-http يُستورد ديناميكيًا فيمكن أن يصل الاسترجاع إلى
// isFilePersistActive()/sessionRootDir قبل تثبيت الحوض/الجذر فيفوّت الاسترجاع في سطح المكتب.
// نرفع وعد التهيئة وننتظره أولًا داخل الاسترجاع؛ في الويب التهيئة لا-عملية فالسلوك كما كان.
const desktopBootstrap: Promise<void> = (async () => {
  if (isTauri()) await bootstrapDesktop();
})();

// استرجاع جلسات القرص عند الإقلاع (المهمة 13). التحقق من Tauri يمر عبر منشّط الملفات:
// بلا setFileSink من وضع سطح المكتب (bootstrapDesktop أعلاه يضبط الجذر وينصّب tauriSink)
// يبقى وضع الويب آمنًا بلا استرجاع، والاسترجاع نفسه لا يمنع تشغيل التطبيق عند أي فشل.
void (async () => {
  try {
    await desktopBootstrap;
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
