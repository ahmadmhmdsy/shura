// [انحراف موثق عن أسماء واجهة الخطة] plugin-fs 2.5.2 لا يصدّر ensureDir (كان اسم واجهة أقدم):
// mkdir(recursive) هو نفسه العقد الموثق «ensureDir = mkdir recursive»؛ وwriteFile يأخذ بايتات
// فقط، وwriteTextFile هو المسار النصي UTF-8 بنفس الخيارات (create) وبلا إلحاق فيكتب فوق
// السابق — دلالة العقد نفسها.
import { exists, mkdir, readDir, readFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { documentDir, join } from "@tauri-apps/api/path";
import type { FileSink } from "./sink";

// [انحراف موثق عن كود الخطة — تججير المسارات النسبية وتوحيد فواصل ويندوز] كود الخطة يمرر مسارات
// المرحّل النسبية («sessions/...») إلى plugin-fs كما هي، والمكتبة تحل النسبي بلا baseDir مقابل
// CWD للعملية (دليلها: «Paths accessed with this API must be either relative to one of the base
// directories») وهو مجلد التطبيق في سطح المكتب لا Documents — فتكتب خارج نطاق الصلاحية
// $DOCUMENTS/Shura/** ويرفض plugin-fs النداء، عكس الناتج المتوقع للخطة («الملفات تحت
// Documents\\Shura\\sessions\\»). نجذّر النسبي عند $DOCUMENTS/Shura (جذر الصلاحية نفسه؛
// جذر الجلسات المحفوظ في الإعدادات Shura\\sessions — انظر bootstrapDesktop) ونُجري المطلق
// و$-البادئة كما هي. الفواصل تُوحَّد إلى فواصل ويندوز الأصلية (تحفظ المهمة 13-4: الاسترجاع يبني
// مسارات مختلطة "/" فوق جذر "\\"). بقية عقد FileSink كما وثّقتها الجولة 13: ensureDir =
// mkdir recursive، UTF-8، readDir أسماء المداخل مباشرة تحت المسار.
let shuraRoot: Promise<string> | null = null;
function desktopRoot(): Promise<string> {
  shuraRoot ??= (async () => join(await documentDir(), "Shura"))();
  return shuraRoot;
}

function isAbsoluteLike(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\") || p.startsWith("$");
}

async function resolvePath(p: string): Promise<string> {
  const normalized = p.replace(/\//g, "\\");
  if (isAbsoluteLike(normalized)) return normalized;
  return join(await desktopRoot(), normalized);
}

// [دور إصلاح مأذون — شكل الخطأ في عقد FileSink] مراجعة المهمة 6 طلبت «شكل الخطأ code» كما في
// حوض الذاكرة (sink.ts: Error برسالة «ENOENT: <مسار>»)، وplugin-fs يرفض برسائل نصية من النداء
// الأساسي بلا شكل موحد. التخطيط المعتمد (Error برسالة + خاصية code):
//   /not allowed|denied|forbidden|scope/ => "EPERM"   (نطاق capabilities)
//   /not found|No such file|ENOENT/      => "ENOENT"
//   غير ذلك                              => "EUNKNOWN" والرسالة الأصلية كاملًا داخل الرسالة
// (الأصل كله محفوظ أيضًا في cause). لا تبلع شيئًا ولا يبدل سلوك الرفض: يعاد الرفض بالشكل فقط.
function wrapSinkError(path: string, cause: unknown): Error {
  const raw = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : String(cause);
  const code = /not allowed|denied|forbidden|scope/i.test(raw) ? "EPERM"
    : /not found|No such file|ENOENT/i.test(raw) ? "ENOENT"
    : "EUNKNOWN";
  const e = new Error(`${code}: ${path}${raw ? " — " + raw : ""}`, { cause });
  (e as { code?: string }).code = code;
  return e;
}

export function tauriFileSink(): FileSink {
  return {
    async ensureDir(p) {
      const rp = await resolvePath(p);
      try { await mkdir(rp, { recursive: true }); } catch (e) { throw wrapSinkError(rp, e); }
    },
    async writeFile(p, content) {
      const rp = await resolvePath(p);
      try { await writeTextFile(rp, content, { create: true }); } catch (e) { throw wrapSinkError(rp, e); }
    },
    async readFile(p) {
      const rp = await resolvePath(p);
      try { return new TextDecoder().decode(await readFile(rp)); } catch (e) { throw wrapSinkError(rp, e); }
    },
    async exists(p) {
      const rp = await resolvePath(p);
      try { return await exists(rp); } catch (e) { throw wrapSinkError(rp, e); }
    },
    async readDir(p) {
      const rp = await resolvePath(p);
      try { return (await readDir(rp)).map((e) => e.name); } catch (e) { throw wrapSinkError(rp, e); }
    },
  };
}
