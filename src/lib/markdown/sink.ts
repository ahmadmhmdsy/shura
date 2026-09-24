export interface FileSink {
  ensureDir(path: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  readDir(path: string): Promise<string[]>;
  // [المهمة 2] عمليات الحذف وإعادة التسمية بعقد موحّد: remove يأخذ recursive (الافتراضي false
  // كما في plugin-fs)، وrename مساران. حوض الذاكرة يطبّقهما على مفاتيحه (ليني: remove للغائب
  // صامت، rename للغائب يرفض ENOENT لتطابق plugin-fs)، وحوض Tauri يمرّرهما عبر المجاور المحدود.
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
}

export function memoryFileSink(): FileSink & { reset(): void; tree(): string[] } {
  const files = new Map<string, string>();
  return {
    async ensureDir() {},
    async writeFile(p, c) { files.set(p, c); },
    async readFile(p) { const c = files.get(p); if (c === undefined) throw new Error("ENOENT: " + p); return c; },
    async exists(p) { return files.has(p); },
    // [إصلاح مأذون موثق — المهمة 13] readDir كانت راية [] دائمًا (Minor 8 من مراجعة المهمة 6:
    // «readDir الذاكرة يعيد [] دائمًا — يلزم حقيقي قبل استرجاع شجرة المجلد»)، واختبار recoverFromDisk
    // في موجز المهمة 13 يفشل معها حتمًا (RED-2: توقّع معيدين والحصل []. الدلالة: أسماء المداخل
    // (ملفات ومجلدات) مباشرة تحت المسار، مشتقة من مفاتيح الملفات المخزنة ومرتبة.
    async readDir(p) {
      const base = p.replace(/[\\/]+$/, "");
      const prefix = base === "" ? "" : base + "/";
      const names = new Set<string>();
      for (const f of files.keys()) {
        if (!f.startsWith(prefix)) continue;
        const rest = f.slice(prefix.length);
        if (rest) names.add(rest.split("/")[0]);
      }
      return [...names].sort();
    },
    async remove(p, options) {
      const base = p.replace(/[\\/]+$/, "");
      const prefix = base + "/";
      for (const k of [...files.keys()]) {
        if (k === base || (options?.recursive === true && k.startsWith(prefix))) files.delete(k);
      }
    },
    async rename(oldPath, newPath) {
      if (oldPath === newPath) return;
      const prefix = oldPath + "/";
      const hits = [...files.keys()].filter((k) => k === oldPath || k.startsWith(prefix));
      if (hits.length === 0) throw new Error("ENOENT: " + oldPath);
      for (const k of hits) {
        const content = files.get(k);
        files.delete(k);
        if (content === undefined) continue;
        files.set(newPath + k.slice(oldPath.length), content);
      }
    },
    reset() { files.clear(); },
    tree() { return [...files.keys()]; },
  };
}

const nullSink: FileSink = {
  async ensureDir() {}, async writeFile() {}, async readFile() { throw new Error("لا ملفات في وضع الويب"); },
  async exists() { return false; }, async readDir() { return []; },
  async remove() { throw new Error("لا ملفات في وضع الويب"); },
  async rename() { throw new Error("لا ملفات في وضع الويب"); },
};
let activeSink: FileSink | null = null;
export function setFileSink(s: FileSink): void { activeSink = s; }
export function getFileSink(): FileSink { return activeSink ?? nullSink; }
export function isFilePersistActive(): boolean { return activeSink !== null; }
