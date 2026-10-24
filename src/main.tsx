import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Toaster, toast } from "sonner";
// The typeface named by --sura-font-sans. Bundled rather than linked so the desktop
// build never depends on a network fetch at runtime, and limited to the four
// weights the components actually use (normal / medium / semibold / bold).
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "./styles/globals.css";
import { useSessionsStore } from "@/state/sessionsStore";
import { useSettingsStore } from "@/state/settingsStore";
import { getFileSink, isFilePersistActive } from "@/lib/markdown/sink";
import { hasTombstone, importSessionAtomically, reconcileInterruptedTurns } from "@/lib/db/repos";
import { isTauri } from "@/lib/transport/transport";
import { bootstrapDesktop, ensureDesktopSessionRoot } from "@/lib/desktop/bootstrap";
import { sessionOperationCoordinator } from "@/lib/chat/operationCoordinator";
import { noticeFromRecoveryReport, recoverSessionsFromDisk, type StartupNotice } from "@/lib/startupRecovery";
import { StartupNoticeBanner } from "@/features/startup/StartupNotice";
import { initAppLogging, logger, safeExecuteAsync } from "@/lib/logging";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { uiText } from "@/i18n";
import { cleanupOrphanedTempFiles } from "@/lib/rag/tempCleanup";

async function runNonFatalPhase(phase: () => Promise<void> | void): Promise<void> {
  try {
    await phase();
  } catch (e) {
    // A failed startup/recovery phase must not prevent the remaining phases or the first render.
    // But we log the error so it's not completely silent.
    logger.error("Startup phase failed", undefined, e as Error);
  }
}

export async function runStartup(phases: StartupPhases): Promise<void> {
  await runNonFatalPhase(phases.bootstrap);
  await runNonFatalPhase(phases.loadSettings);
  await runNonFatalPhase(phases.loadSessions);
  let notice: StartupNotice | null = null;
  try {
    notice = await phases.recoverNotice();
  } catch (e) {
    // A failed recovery phase must not prevent the first render, but it is reported.
    logger.error("Startup recovery failed", undefined, e as Error);
    phases.warn?.(uiText.t("startup.recoveryFailed"));
  }
  let liveOperationKeys: readonly string[] | null = null;
  await runNonFatalPhase(async () => {
    liveOperationKeys = phases.activeOperationKeys();
  });
  if (liveOperationKeys === null) {
    // Fail safe: an unknown live-operation set must never be treated as "no live
    // work". Reconciling with an empty set would stop turns that are still running,
    // so the phase is deferred and the user gets one bounded warning instead.
    phases.warn?.(uiText.t("startup.liveOperationsUnknown"));
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
    toast.success(uiText.plural("startup.restored", report.imported.length));
  }
  return noticeFromRecoveryReport(report);
}

function Root({ notice }: { notice: StartupNotice | null }) {
  const [dismissed, setDismissed] = useState(false);
  return (
    <>
      {notice && !dismissed ? <StartupNoticeBanner notice={notice} onDismiss={() => setDismissed(true)} /> : null}
      <App />
      <Toaster
        richColors
        position="bottom-left"
        // Sonner ships its own light palette by default, which put a light toast on
        // the dark app and measured 4.34:1; these variables map it onto the token
        // pairs the rest of the UI uses (Badge/Sidebar use the same danger pair).
        style={{
          "--normal-bg": "var(--sura-surface-elevated)",
          "--normal-text": "var(--sura-text-primary)",
          "--normal-border": "var(--sura-border-primary)",
          "--error-bg": "var(--sura-error-muted)",
          "--error-text": "var(--sura-error-text)",
          "--error-border": "var(--sura-error)",
          "--success-bg": "var(--sura-success-muted)",
          "--success-text": "var(--sura-success)",
          "--success-border": "var(--sura-success)",
          "--warning-bg": "var(--sura-warning-muted)",
          "--warning-text": "var(--sura-warning)",
          "--warning-border": "var(--sura-warning)",
          "--info-bg": "var(--sura-info-muted)",
          "--info-text": "var(--sura-info)",
          "--info-border": "var(--sura-info)",
        } as React.CSSProperties}
      />
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
    loadSettings: async () => {
      await useSettingsStore.getState().load();
      await ensureDesktopSessionRoot();
      // The stored language decides lang/dir on <html> (and the title) before the first render.
      uiText.setLocale(useSettingsStore.getState().language);
      uiText.applyDocumentLocale();
      // [T8.1] ملفات مؤقتة خلّفها تشغيل سابق انهار قبل تنظيف نفسه؛ نكنسها عند الإقلاع
      // ما لم يكن الإعداد "manual" (تنظيف يدوي فقط).
      if (useSettingsStore.getState().ragSettings.tempCleanup !== "manual") {
        await cleanupOrphanedTempFiles();
      }
    },
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
