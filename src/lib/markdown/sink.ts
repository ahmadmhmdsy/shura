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
