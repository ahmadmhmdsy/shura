import { isTauri, setTransportFetch } from "@/lib/transport/transport";
import { setFileSink } from "@/lib/markdown/sink";
import { tauriFileSink } from "@/lib/markdown/tauriSink";
import { useSettingsStore } from "@/state/settingsStore";
import { documentDir, join } from "@tauri-apps/api/path";

export async function bootstrapDesktop(): Promise<void> {
  if (!isTauri()) return;
  const mod = await import("@tauri-apps/plugin-http");
  setTransportFetch(mod.fetch as unknown as typeof fetch);
  setFileSink(tauriFileSink());
  const s = useSettingsStore.getState();
  await s.load();
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
