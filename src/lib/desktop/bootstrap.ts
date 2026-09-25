import { isTauri, setTransportFetch } from "@/lib/transport/transport";
import { setFileSink } from "@/lib/markdown/sink";
import { tauriFileSink } from "@/lib/markdown/tauriSink";
import { useSettingsStore } from "@/state/settingsStore";
import { documentDir, join } from "@tauri-apps/api/path";

let bootstrapped = false;

export async function bootstrapDesktop(): Promise<void> {
  if (!isTauri()) return;
  // Idempotent: startup and any later re-entry must install the same sink/transport once.
  if (bootstrapped) return;
  bootstrapped = true;
  const mod = await import("@tauri-apps/plugin-http");
  setTransportFetch(mod.fetch as unknown as typeof fetch);
  setFileSink(tauriFileSink());
  // Settings are already loaded by the startup phase; reloading here would overwrite a
  // root the user configured, so only the default is filled in when it is still missing.
  const s = useSettingsStore.getState();
  if (!s.sessionRootDir) await s.load();
  // [انحراف موثق 1/2 عن كود الخطة] الحرفي «if (!s.sessionRootDir)» يقرأ لقطة getState()
  // الملتقطة قبل load() فقيمتها null دائمًا ويستبدل جذرًا محفوظًا بالإفتراضي في كل إقلاع؛
  // الحالة تُقرأ بعد التحميل.
  // [انحراف موثق 2/2] جذر الجلسات = Shura\sessions لا Shura: عقد الاسترجاع (المهمة 13) يقرأ
  // مجلدات الجلسات مباشرة تحت الجذر (اختباره recoverFromDisk(sink, "sessions") وشجرة وثيقة
  // التصميم «Documents\Shura\sessions\<مجلد>»)، والمرحّل يكتب «sessions/<folder>» نسبيًا
  // (tauriSink يجذّره عند Documents\Shura). بجذر Shura فقط يصبح الاسترجاع أعمى عن كتابات
  // سطح المكتب حتمًا.
  if (!useSettingsStore.getState().sessionRootDir) {
    const root = await join(await documentDir(), "Shura", "sessions");
    await useSettingsStore.getState().setSessionRootDir(root);
  }
}
