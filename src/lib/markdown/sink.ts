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
    async readDir() { return []; },
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
