// [انحراف موثق عن أسماء واجهة الخطة] plugin-fs 2.5.2 لا يصدّر ensureDir (كان اسم واجهة أقدم):
// mkdir(recursive) هو نفسه العقد الموثق «ensureDir = mkdir recursive»؛ وwriteFile يأخذ بايتات
// فقط، وwriteTextFile هو المسار النصي UTF-8 بنفس الخيارات (create) وبلا إلحاق فيكتب فوق
// السابق — دلالة العقد نفسها.
import { exists, mkdir, readDir, readFile, remove as removePath, rename as renamePath, writeTextFile } from "@tauri-apps/plugin-fs";
import { documentDir, isAbsolute, join, normalize, sep } from "@tauri-apps/api/path";
import type { FileSink } from "./sink";

// [المهمة 2 — مسارات محمولة] الجولة 13 كانت تحوّل كل / إلى backslash وتُمرّر المطلق كما هو.
// الوضع الصحيح: واجهات مسار Tauri فقط (isAbsolute/join/normalize/sep) بلا أي استبدال فواصل
// يدوي — فهي تنتج فواصل المنصة الأصلية بنفسها، وتعمل على ويندوز وPOSIX حرفيًا. النسبي يُجاور
// join(await desktopRoot(), p)، والمطلق يُطبَّع معجميًا، وكل مدخل فيه مقطع .. يُرفض، وكل
// ناتج مطبَّع خارج جذر desktopRoot يُرفض (EPERM) قبل أي نداء plugin-fs. $-البادئة تبقى
// كما هي: نطاق capabilities في الطبقة الروسية هو صاحب القرار هناك (وهو الآن $DOCUMENT/Shura/**
// حصريًا — الفحص المعجمي هنا طبقة إضافية لا بديل عنه؛ يطابق path_policy.rs).
let shuraRoot: Promise<string> | null = null;
function desktopRoot(): Promise<string> {
  shuraRoot ??= (async () => join(await documentDir(), "Shura"))();
  return shuraRoot;
}

// [حجب المسار المطلق قبل الواجهة] رسائل الأخطاء تُخزَّن في الجلسات (UI persistence)، فالمسار
// المطلق و$-البادئة يُحجبان، ويبقى المدخل النسبي كما هو (لا يحمل معلومة بيئة).
function looksAbsolute(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\") || p.startsWith("/") || p.startsWith("$");
}
function displayPath(p: string): string {
  return looksAbsolute(p) ? "<redacted>" : p;
}

function hasParentSegment(p: string): boolean {
  return p.split(/[\\/]/).includes("..");
}

function scopeError(display: string, detail: string): Error {
  const e = new Error(`EPERM: ${display} — ${detail}`);
  (e as { code?: string }).code = "EPERM";
  return e;
}

async function assertWithinRoot(resolved: string, display: string): Promise<void> {
  const rootNorm = await normalize(await desktopRoot());
  const norm = await normalize(resolved);
  if (norm === rootNorm) return;
  if (!norm.startsWith(rootNorm + await sep())) throw scopeError(display, "المسار خارج نطاق Shura");
}

async function resolvePath(p: string): Promise<string> {
  const display = displayPath(p);
  if (hasParentSegment(p)) throw scopeError(display, "مقطع .. مرفوض خارج حل الجذر");
  if (p.startsWith("$")) return p;
  if (await isAbsolute(p)) {
    const resolved = await normalize(p);
    await assertWithinRoot(resolved, display);
    return resolved;
  }
  const resolved = await join(await desktopRoot(), p);
  await assertWithinRoot(resolved, display);
  return resolved;
}

// [دور إصلاح مأذون — شكل الخطأ في عقد FileSink] مراجعة المهمة 6 طلبت «شكل الخطأ code» كما في
// حوض الذاكرة (sink.ts: Error برسالة «ENOENT: <مسار>»)، وplugin-fs يرفض برسائل نصية من النداء
// الأساسي بلا شكل موحد. التخطيط المعتمد (Error برسالة + خاصية code):
//   /not allowed|denied|forbidden|scope/ => "EPERM"   (نطاق capabilities)
//   /not found|No such file|ENOENT/      => "ENOENT"
//   غير ذلك                              => "EUNKNOWN" والرسالة الأصلية كاملًا داخل الرسالة
// (الأصل كله محفوظ أيضًا في cause). لا تبلع شيئًا ولا يبدل سلوك الرفض: يعاد الرفض بالشكل فقط.
// [المهمة 2 — الحجب] المسار المطلق المحلول لا يدخل الرسالة: يُستبدل بعرض displayPath، وتُنظَّف
// كل وروده في رسالة الخطأ الأصلية من plugin-fs (بفاصلَي المنصة) بالعرض نفسه.
function redactAbsolute(message: string, resolved: string, display: string): string {
  if (!resolved || resolved === display) return message;
  let out = message.split(resolved).join(display);
  const mirrored = resolved.includes("\\") ? resolved.replace(/\\/g, "/") : resolved.replace(/\//g, "\\");
  if (mirrored !== resolved) out = out.split(mirrored).join(display);
  return out;
}

function wrapSinkError(resolved: string, display: string, cause: unknown): Error {
  const raw = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : String(cause);
  const code = /not allowed|denied|forbidden|scope/i.test(raw) ? "EPERM"
    : /not found|No such file|ENOENT/i.test(raw) ? "ENOENT"
    : "EUNKNOWN";
  const redacted = redactAbsolute(raw, resolved, display);
  const e = new Error(`${code}: ${display}${redacted ? " — " + redacted : ""}`, { cause });
  (e as { code?: string }).code = code;
  return e;
}

export function tauriFileSink(): FileSink {
  return {
    async ensureDir(p) {
      const rp = await resolvePath(p);
      try { await mkdir(rp, { recursive: true }); } catch (e) { throw wrapSinkError(rp, displayPath(p), e); }
    },
    async writeFile(p, content) {
      const rp = await resolvePath(p);
      try { await writeTextFile(rp, content, { create: true }); } catch (e) { throw wrapSinkError(rp, displayPath(p), e); }
    },
    async readFile(p) {
      const rp = await resolvePath(p);
      try { return new TextDecoder().decode(await readFile(rp)); } catch (e) { throw wrapSinkError(rp, displayPath(p), e); }
    },
    async exists(p) {
      const rp = await resolvePath(p);
      try { return await exists(rp); } catch (e) { throw wrapSinkError(rp, displayPath(p), e); }
    },
    async readDir(p) {
      const rp = await resolvePath(p);
      try { return (await readDir(rp)).map((e) => e.name); } catch (e) { throw wrapSinkError(rp, displayPath(p), e); }
    },
    async remove(p, options) {
      const rp = await resolvePath(p);
      try { await removePath(rp, { recursive: options?.recursive ?? false }); }
      catch (e) { throw wrapSinkError(rp, displayPath(p), e); }
    },
    async rename(oldPath, newPath) {
      const oldRp = await resolvePath(oldPath);
      const newRp = await resolvePath(newPath);
      try { await renamePath(oldRp, newRp); }
      catch (e) { throw wrapSinkError(newRp, displayPath(newPath), e); }
    },
  };
}
