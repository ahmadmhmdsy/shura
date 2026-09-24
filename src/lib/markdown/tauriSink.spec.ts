// [المهمة 2 — اختبارات النطاق والمسارات المحمولة] اختبارات RED أولًا: نطاق $DOCUMENT/Shura
// المفرد (لا $DOCUMENTS)، والمسارات النسبية تُجاور بالفواصل POSIX الأصلية (لا تحويل إلى backslash)،
// وحظر ../ والمطلق خارج جذر سطح المكتب، وremove/rename داخل النطاق مع حجب المسارات المطلقة في
// رسائل الخطأ. مجالس plugin-fs وapi/path مُزدوفة بالكامل (بيئة jsdom بلا Tauri).
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { remove as fsRemove, rename as fsRename, writeTextFile } from "@tauri-apps/plugin-fs";
import { tauriFileSink } from "./tauriSink";
import { memoryFileSink } from "./sink";

vi.mock("@tauri-apps/api/path", () => {
  // [تطبيع معجمي للتجزيرة] نفس دلالات path_policy.rs الروسي: إسقاط "." وحل ".." معجميًا.
  const lexicalNormalize = (p: string): string => {
    const absolute = p.startsWith("/") || p.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("$");
    const parts = p.split(/[\\/]+/).filter((s) => s !== "" && s !== ".");
    const out: string[] = [];
    for (const part of parts) {
      if (part === "..") {
        if (out.length > 0) out.pop();
      } else out.push(part);
    }
    return (absolute ? "/" : "") + out.join("/");
  };
  return {
    documentDir: vi.fn(() => Promise.resolve("/home/user/Documents")),
    join: vi.fn((...parts: string[]) => Promise.resolve(parts.filter((s) => s !== "").join("/"))),
    isAbsolute: vi.fn((p: string) => Promise.resolve(/^[A-Za-z]:[\\/]/.test(p) || p.startsWith("/") || p.startsWith("\\\\") || p.startsWith("$"))),
    normalize: vi.fn((p: string) => Promise.resolve(lexicalNormalize(p))),
    sep: vi.fn(() => "/"),
  };
});

vi.mock("@tauri-apps/plugin-fs", () => ({
  mkdir: vi.fn(() => Promise.resolve()),
  writeTextFile: vi.fn(() => Promise.resolve()),
  readFile: vi.fn(() => Promise.resolve(new Uint8Array())),
  exists: vi.fn(() => Promise.resolve(false)),
  readDir: vi.fn(() => Promise.resolve([])),
  remove: vi.fn(() => Promise.resolve()),
  rename: vi.fn(() => Promise.resolve()),
}));

beforeEach(() => { vi.clearAllMocks(); });

describe("tauri capability scope", () => {
  it("uses Tauri's singular document scope", () => {
    const capability = JSON.parse(
      readFileSync("src-tauri/capabilities/default.json", "utf8"),
    );
    const serialized = JSON.stringify(capability);
    expect(serialized).toContain("$DOCUMENT/Shura/**");
    expect(serialized).not.toContain("$DOCUMENTS");
  });
});

describe("tauri sink path resolution", () => {
  it("joins a relative path without replacing POSIX separators", async () => {
    const { join } = await import("@tauri-apps/api/path");
    // The default join mock builds the complete path, so this assertion detects a dropped filename.
    await tauriFileSink().writeFile("sessions/s1/meta.json", "{}");
    expect(join).toHaveBeenCalledWith("/home/user/Documents/Shura", "sessions/s1/meta.json");
    expect(writeTextFile).toHaveBeenCalledWith("/home/user/Documents/Shura/sessions/s1/meta.json", "{}", { create: true });
  });

  it("يحل المطلق داخل الجذر بالتطبيع دون تحويل الفواصل", async () => {
    await tauriFileSink().writeFile("/home/user/Documents/Shura/sessions/abs.md", "x");
    expect(writeTextFile).toHaveBeenCalledWith("/home/user/Documents/Shura/sessions/abs.md", "x", { create: true });
  });

  it("يرفض .. النسبي خارج الجذر", async () => {
    await expect(tauriFileSink().writeFile("../escape.txt", "{}")).rejects.toMatchObject({ code: "EPERM" });
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it("يرفض المسار المطلق خارج جذر سطح المكتب", async () => {
    await expect(tauriFileSink().writeFile("/etc/shadow", "x")).rejects.toMatchObject({ code: "EPERM" });
  });

  it("يرفض بادئة الشقيقة (Shurax) خارج الجذر", async () => {
    await expect(tauriFileSink().writeFile("/home/user/Documents/Shurax/evil", "x")).rejects.toMatchObject({ code: "EPERM" });
  });
});

describe("tauri sink remove/rename", () => {
  it("remove يستدعي plugin remove بالمسار المحلول داخل النطاق", async () => {
    await tauriFileSink().remove("sessions/s1", { recursive: true });
    expect(fsRemove).toHaveBeenCalledWith("/home/user/Documents/Shura/sessions/s1", { recursive: true });
  });

  it("remove يستدعي plugin remove بدون خيارات افتراضيًا", async () => {
    await tauriFileSink().remove("sessions/s1/meta.json");
    expect(fsRemove).toHaveBeenCalledWith("/home/user/Documents/Shura/sessions/s1/meta.json", { recursive: false });
  });

  it("rename يحل كلا المسارين عبر جذر Shura", async () => {
    await tauriFileSink().rename("sessions/a", "sessions/b");
    expect(fsRename).toHaveBeenCalledWith(
      "/home/user/Documents/Shura/sessions/a",
      "/home/user/Documents/Shura/sessions/b",
    );
  });

  it("يلفّ خطأ remove برمز EPERM ويحجب المسار المطلق", async () => {
    vi.mocked(fsRemove).mockRejectedValueOnce(new Error("access denied: /home/user/Documents/Shura/sessions/s1"));
    const error = (await tauriFileSink().remove("sessions/s1").catch((e: unknown) => e)) as Error & { code?: string };
    expect(error.code).toBe("EPERM");
    expect(error.message).not.toContain("/home/user");
    expect(error.message).toContain("sessions/s1");
  });

  it("يلفّ خطأ rename برمز ENOENT ويحجب المسار المطلق", async () => {
    vi.mocked(fsRename).mockRejectedValueOnce(new Error("No such file or directory"));
    const error = (await tauriFileSink().rename("sessions/a", "sessions/b").catch((e: unknown) => e)) as Error & { code?: string };
    expect(error.code).toBe("ENOENT");
    expect(error.message).not.toContain("/home/user");
  });
});

describe("memory sink remove/rename", () => {
  it("remove يحذف الملف مفردًا والشجرة عند recursive", async () => {
    const sink = memoryFileSink();
    await sink.writeFile("sessions/s1/meta.json", "{}");
    await sink.writeFile("sessions/s1/turns/t1/a.md", "x");
    await sink.writeFile("sessions/s2/meta.json", "{}");
    await sink.remove("sessions/s1", { recursive: true });
    expect(await sink.exists("sessions/s1/meta.json")).toBe(false);
    expect(await sink.exists("sessions/s1/turns/t1/a.md")).toBe(false);
    expect(await sink.exists("sessions/s2/meta.json")).toBe(true);
    await sink.remove("sessions/s2/meta.json");
    expect(await sink.exists("sessions/s2/meta.json")).toBe(false);
  });

  it("remove بدون recursive على مجلد غير فارغ يرفض ENOTEMPTY", async () => {
    const sink = memoryFileSink();
    await sink.writeFile("sessions/s1/meta.json", "{}");
    await expect(sink.remove("sessions/s1")).rejects.toThrow(/ENOTEMPTY/);
    expect(await sink.exists("sessions/s1/meta.json")).toBe(true);
  });

  it("remove بـ recursive يحذف الشجرة كاملة والغائب صامت idempotent", async () => {
    const sink = memoryFileSink();
    await sink.writeFile("sessions/s1/turns/t1/a.md", "x");
    await sink.writeFile("sessions/s1/sub/b.md", "y");
    await sink.writeFile("sessions/s2/meta.json", "{}");
    await sink.remove("sessions/s1", { recursive: true });
    expect(await sink.exists("sessions/s1/turns/t1/a.md")).toBe(false);
    expect(await sink.exists("sessions/s1/sub/b.md")).toBe(false);
    expect(await sink.exists("sessions/s2/meta.json")).toBe(true);
    await expect(sink.remove("sessions/absent", { recursive: true })).resolves.toBeUndefined();
  });

  it("rename ينقل الملف وشجرة المجلد ويُخطئ ENOENT للغائب", async () => {
    const sink = memoryFileSink();
    await sink.writeFile("sessions/a/f.txt", "x");
    await sink.writeFile("sessions/a/sub/g.txt", "y");
    await sink.rename("sessions/a", "sessions/b");
    expect(await sink.exists("sessions/a/f.txt")).toBe(false);
    expect(await sink.readFile("sessions/b/f.txt")).toBe("x");
    expect(await sink.readFile("sessions/b/sub/g.txt")).toBe("y");
    await expect(sink.rename("sessions/absent", "sessions/c")).rejects.toThrow(/ENOENT/);
  });
});

describe("memory sink readDir after rename", () => {
  it("readDir يعكس إعادة التسمية", async () => {
    const sink = memoryFileSink();
    await sink.writeFile("sessions/a/f.txt", "x");
    await sink.rename("sessions/a", "sessions/b");
    expect(await sink.readDir("sessions")).toEqual(["b"]);
  });
});
