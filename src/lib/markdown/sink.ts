export interface FileSink {
  ensureDir(path: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  readDir(path: string): Promise<string[]>;
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
    reset() { files.clear(); },
    tree() { return [...files.keys()]; },
  };
}

const nullSink: FileSink = {
  async ensureDir() {}, async writeFile() {}, async readFile() { throw new Error("لا ملفات في وضع الويب"); },
  async exists() { return false; }, async readDir() { return []; },
};
let activeSink: FileSink | null = null;
export function setFileSink(s: FileSink): void { activeSink = s; }
export function getFileSink(): FileSink { return activeSink ?? nullSink; }
export function isFilePersistActive(): boolean { return activeSink !== null; }
