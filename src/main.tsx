import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Toaster, toast } from "sonner";
import "./styles/globals.css";
import { useSessionsStore } from "@/state/sessionsStore";
import { useSettingsStore } from "@/state/settingsStore";
import { getFileSink, isFilePersistActive } from "@/lib/markdown/sink";
import { hasTombstone, importSessionAtomically, reconcileInterruptedTurns } from "@/lib/db/repos";
import { isTauri } from "@/lib/transport/transport";
import { bootstrapDesktop } from "@/lib/desktop/bootstrap";
import { sessionOperationCoordinator } from "@/lib/chat/operationCoordinator";
import { noticeFromRecoveryReport, recoverSessionsFromDisk, type StartupNotice } from "@/lib/startupRecovery";
import { StartupNoticeBanner } from "@/features/startup/StartupNotice";
import { initAppLogging, logger, safeExecuteAsync } from "@/lib/logging";
import { ErrorBoundary } from "@/components/ErrorBoundary";

async function runNonFatalPhase(phase: () => Promise<void> | void): Promise<void> {
  try {
    await phase();
  } catch (e) {
    // A failed startup/recovery phase must not prevent the remaining phases or the first render.
    // But we log the error so it's not completely silent.
    console.error("Startup phase failed:", e);
  }
}

export async function runStartup(phases: StartupPhases): Promise<void> {
  await runNonFatalPhase(phases.bootstrap);
  await runNonFatalPhase(phases.loadSettings);
  await runNonFatalPhase(phases.loadSessions);
  let notice: StartupNotice | null = null;
  try {
    notice = await phases.recoverNotice();
  } catch {
    // A failed recovery phase must not prevent the first render; it is reported below.
  }
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
  phases.render(notice);
}
export interface StartupPhases {
  bootstrap: () => Promise<void>;
  loadSettings: () => Promise<void>;
  loadSessions: () => Promise<void>;
  /** Recovery returns the visible notice, so nothing is reported as a clean success. */
  recoverNotice: () => Promise<StartupNotice | null>;
  activeOperationKeys: () => readonly string[];
  reconcile: (liveOperationIds: ReadonlySet<string>) => Promise<unknown>;
  /** Bounded startup warning sink; a failure must be visible, not silent. */
  warn?: (message: string) => void;
  render: (notice?: StartupNotice | null) => void;
}

// المهمة 14: تهيئة سطح المكتب ثم الاسترجاع كمرحلة مستقلة غير مميتة، قبل أول عرض.
// الاستيراد ذري لكل جلسة (بيانات + جدول التمريرات) وأي خطأ يصبح تحذيرًا مرئيًا.
async function recoverNotice(): Promise<StartupNotice | null> {
  const sessionRootDir = useSettingsStore.getState().sessionRootDir;
  const report = await recoverSessionsFromDisk({
    sink: getFileSink(),
    rootDir: sessionRootDir ?? "",
    filePersistActive: isFilePersistActive(),
    existingSessionCount: () => useSessionsStore.getState().sessions.length,
    isTombstoned: hasTombstone,
    importSession: (payload) => importSessionAtomically(
      payload.meta, payload.messages, payload.turns, payload.usageEvents,
    ),
    onImported: () => useSessionsStore.getState().load(),
  });
  if (report.imported.length > 0) {
    toast.success(`استُرجعت ${report.imported.length} جلسة من القرص`);
  }
  return noticeFromRecoveryReport(report);
}

function Root({ notice }: { notice: StartupNotice | null }) {
  const [dismissed, setDismissed] = useState(false);
  return (
    <>
      {notice && !dismissed ? <StartupNoticeBanner notice={notice} onDismiss={() => setDismissed(true)} /> : null}
      <App />
      <Toaster richColors position="bottom-left" />
    </>
  );
}

// Global error / unhandledrejection / visibility / unload listeners are registered once,
// here, before the first render, by the (idempotent) initAppLogging. App keeps its own call
// for tests that render the tree directly; that call is now a no-op instead of double-reporting.
initAppLogging();

// Check if running in Tauri or browser
const isTauriEnv = isTauri();
logger.info("Environment detected", { isTauri: isTauriEnv, userAgent: navigator.userAgent });

if (!isTauriEnv) {
  logger.warn("Running in browser mode - some features may not work");
}

const rootElement = typeof document === "undefined" ? null : document.getElementById("root");
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  void safeExecuteAsync(() => runStartup({
    bootstrap: async () => {
      if (isTauri()) await bootstrapDesktop();
    },
    loadSettings: () => useSettingsStore.getState().load(),
    loadSessions: () => useSessionsStore.getState().load(),
    recoverNotice,
    activeOperationKeys: () => sessionOperationCoordinator.activeOperationKeys(),
    reconcile: reconcileInterruptedTurns,
    warn: (message) => toast.warning(message),
    render: (notice) => {
      root.render(
        <React.StrictMode>
          <ErrorBoundary>
            <Root notice={notice ?? null} />
          </ErrorBoundary>
        </React.StrictMode>
      );
    },
  }), "runStartup", undefined);
}
