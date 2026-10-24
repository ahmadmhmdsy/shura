import { isTauri, setTransportFetch } from "@/lib/transport/transport";
import { setFileSink } from "@/lib/markdown/sink";
import { tauriFileSink } from "@/lib/markdown/tauriSink";
import { useSettingsStore } from "@/state/settingsStore";
import { documentDir, join } from "@tauri-apps/api/path";

let bootstrapped = false;

/**
 * Installs the desktop transport and file sink. Runs before settings load, so it must
 * not read or write settings; the default session root is filled in afterwards by
 * `ensureDesktopSessionRoot`.
 */
export async function bootstrapDesktop(): Promise<void> {
  if (!isTauri()) return;
  // Idempotent: startup and any later re-entry must install the same sink/transport once.
  // The flag is set only after both are installed, so a failed import can be retried.
  if (bootstrapped) return;
  const mod = await import("@tauri-apps/plugin-http");
  setTransportFetch(mod.fetch as unknown as typeof fetch);
  setFileSink(tauriFileSink());
  bootstrapped = true;
}

/**
 * Fills in the default session root when the loaded settings have none. Must run after
 * the settings load: called earlier it would replace a root the user configured.
 */
export async function ensureDesktopSessionRoot(): Promise<void> {
  if (!isTauri()) return;
  // [انحراف موثق 2/2] جذر الجلسات = Shura\sessions لا Shura: عقد الاسترجاع (المهمة 13) يقرأ
  // مجلدات الجلسات مباشرة تحت الجذر (اختباره recoverFromDisk(sink, "sessions") وشجرة وثيقة
  // التصميم «Documents\Shura\sessions\<مجلد>»)، والمرحّل يكتب «sessions/<folder>» نسبيًا
  // (tauriSink يجذّره عند Documents\Shura). بجذر Shura فقط يصبح الاسترجاع أعمى عن كتابات
  // سطح المكتب حتمًا.
  if (useSettingsStore.getState().sessionRootDir) return;
  const root = await join(await documentDir(), "Shura", "sessions");
  await useSettingsStore.getState().setSessionRootDir(root);
}
