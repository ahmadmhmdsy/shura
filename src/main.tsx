import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Toaster, toast } from "sonner";
import "./styles/globals.css";
import { useSessionsStore } from "@/state/sessionsStore";
import { useSettingsStore } from "@/state/settingsStore";
import { getFileSink, isFilePersistActive } from "@/lib/markdown/sink";
import { recoverFromDisk } from "@/lib/markdown/parser";
import { appendMessage, createSession, reconcileInterruptedTurns, recordUsage } from "@/lib/db/repos";
import { isTauri } from "@/lib/transport/transport";
import { bootstrapDesktop } from "@/lib/desktop/bootstrap";
import { sessionOperationCoordinator } from "@/lib/chat/operationCoordinator";

export interface StartupPhases {
  bootstrap: () => Promise<void>;
  loadSettings: () => Promise<void>;
  loadSessions: () => Promise<void>;
  recover: () => Promise<void>;
  activeOperationKeys: () => readonly string[];
  reconcile: (liveOperationIds: ReadonlySet<string>) => Promise<unknown>;
  /** Bounded startup warning sink; a failure must be visible, not silent. */
  warn?: (message: string) => void;
  render: () => void;
}

async function runNonFatalPhase(phase: () => Promise<void> | void): Promise<void> {
  try {
    await phase();
  } catch {
    // A failed startup/recovery phase must not prevent the remaining phases or the first render.
  }
}

export async function runStartup(phases: StartupPhases): Promise<void> {
  await runNonFatalPhase(phases.bootstrap);
  await runNonFatalPhase(phases.loadSettings);
  await runNonFatalPhase(phases.loadSessions);
  await runNonFatalPhase(phases.recover);
  let liveOperationKeys: readonly string[] | null = null;
  await runNonFatalPhase(async () => {
    liveOperationKeys = phases.activeOperationKeys();
  });
  if (liveOperationKeys === null) {
    // Fail safe: an unknown live-operation set must never be treated as "no live
    // work". Reconciling with an empty set would stop turns that are still running,
    // so the phase is deferred and the user gets one bounded warning instead.
    phases.warn?.("تعذر التحقق من العمليات الجارية — تأجيل مطابقة التمريرات المتوقفة");
  } else {
    await runNonFatalPhase(async () => {
      await phases.reconcile(new Set(liveOperationKeys));
    });
  }
  phases.render();
}

// المهمة 14: تهيئة سطح المكتب (نقل بلا CORS عبر plugin-http + حوض ملفات أصلي + جذر الجلسات).
// الاسترجاع يبقى مرحلة مستقلة غير مميتة، ثم تُحاول المطابقة قبل أول عرض.
async function recoverSessionsFromDisk(): Promise<void> {
  const { sessionRootDir } = useSettingsStore.getState();
  if (!isFilePersistActive() || !sessionRootDir || useSessionsStore.getState().sessions.length !== 0) return;

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
}

const rootElement = typeof document === "undefined" ? null : document.getElementById("root");
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  void runStartup({
    bootstrap: async () => {
      if (isTauri()) await bootstrapDesktop();
    },
    loadSettings: () => useSettingsStore.getState().load(),
    loadSessions: () => useSessionsStore.getState().load(),
    recover: recoverSessionsFromDisk,
    activeOperationKeys: () => sessionOperationCoordinator.activeOperationKeys(),
    reconcile: reconcileInterruptedTurns,
    warn: (message) => toast.warning(message),
    render: () => {
      root.render(
        <React.StrictMode>
          <App />
          <Toaster richColors position="bottom-left" />
        </React.StrictMode>,
      );
    },
  });
}
