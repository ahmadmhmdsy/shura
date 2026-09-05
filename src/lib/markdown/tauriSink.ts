// [انحراف موثق عن أسماء واجهة الخطة] plugin-fs 2.5.2 لا يصدّر ensureDir (كان اسم واجهة أقدم):
// mkdir(recursive) هو نفسه العقد الموثق «ensureDir = mkdir recursive»؛ وwriteFile يأخذ بايتات
// فقط، وwriteTextFile هو المسار النصي UTF-8 بنفس الخيارات (create) وبلا إلحاق فيكتب فوق
// السابق — دلالة العقد نفسها.
import { exists, mkdir, readDir, readFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { documentDir, join } from "@tauri-apps/api/path";
import type { FileSink } from "./sink";

// [انحراف موثق عن كود الخطة — تجذير المسارات النسبية وتوحيد فواصل ويندوز] كود الخطة يمرر مسارات
// المرحّل النسبية («sessions/...») إلى plugin-fs كما هي، والمكتبة تحل النسبي بلا baseDir مقابل
// CWD للعملية (دليلها: «Paths accessed with this API must be either relative to one of the base
// directories») وهو مجلد التطبيق في سطح المكتب لا Documents — فتكتب خارج نطاق الصلاحية
// $DOCUMENTS/Shura/** ويرفض plugin-fs النداء، عكس الناتج المتوقع للخطة («الملفات تحت
// Documents\\Shura\\sessions\\»). نجذّر النسبي عند $DOCUMENTS/Shura (جذر الصلاحية نفسه؛
// جذر الجلسات المحفوظ في الإعدادات Shura\\sessions — انظر bootstrapDesktop) ونُجري المطلق
// و$-البادئة كما هي. الفواصل تُوحَّد إلى فواصل ويندوز الأصلية (تحفظ المهمة 13-4: الاسترجاع يبني
// مسارات مختلطة "/" فوق جذر "\\"). بقية عقد FileSink كما وثّقتها الجولة 13: ensureDir =
// mkdir recursive، UTF-8، readDir أسماء المداخل مباشرة تحت المسار، والخطأ كما يرفعه plugin-fs.
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

export function tauriFileSink(): FileSink {
  return {
    async ensureDir(p) { await mkdir(await resolvePath(p), { recursive: true }); },
    async writeFile(p, content) { await writeTextFile(await resolvePath(p), content, { create: true }); },
    async readFile(p) { return new TextDecoder().decode(await readFile(await resolvePath(p))); },
    async exists(p) { return exists(await resolvePath(p)); },
    async readDir(p) { return (await readDir(await resolvePath(p))).map((e) => e.name); },
  };
}
