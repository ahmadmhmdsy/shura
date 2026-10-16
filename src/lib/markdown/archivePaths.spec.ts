import { describe, expect, it } from "vitest";
import { readDiskTombstones, TombstoneSetError } from "./archivePaths";
import { memoryFileSink } from "./sink";
import type { FileSink } from "./sink";

/** [T7.5] حوض يفشل في readDir بشيفرة محددة: ENOENT تعني «لا شواهد بعد»، وغيرها يعني فشلًا. */
const readDirFails = (code: string): FileSink => {
  const sink = memoryFileSink();
  return {
    ...sink,
    readDir: async () => {
      const error = new Error(code + ": simulated failure");
      (error as { code?: string }).code = code;
      throw error;
    },
  };
};

describe("readDiskTombstones - fail-closed witness policy (T7.5)", () => {
  it("فشل readDir بغير ENOENT يرمي TombstoneSetError لا مجموعة فارغة", async () => {
    await expect(readDiskTombstones(readDirFails("EPERM"), "sessions")).rejects.toBeInstanceOf(TombstoneSetError);
    await expect(readDiskTombstones(readDirFails("EACCES"), "sessions")).rejects.toBeInstanceOf(TombstoneSetError);
  });

  it("ENOENT تعني «لا مجموعة شواهد بعد» فتبقى مجموعة فارغة", async () => {
    expect(await readDiskTombstones(readDirFails("ENOENT"), "sessions")).toEqual(new Set());
  });

  it("يقرأ مجموعة الشواهد السليمة من مجلد tombstones", async () => {
    const sink = memoryFileSink();
    await sink.writeFile("sessions/tombstones/abc.json", JSON.stringify({ id: "abc", deletedAt: 5 }));
    expect(await readDiskTombstones(sink, "sessions")).toEqual(new Set(["abc"]));
  });

  it("شاهد يخالف اسمه محتواه يُرفض fail-closed", async () => {
    const sink = memoryFileSink();
    await sink.writeFile("sessions/tombstones/abc.json", JSON.stringify({ id: "other", deletedAt: 5 }));
    await expect(readDiskTombstones(sink, "sessions")).rejects.toBeInstanceOf(TombstoneSetError);
  });

  it("محتوى شاهد غير قابل للتحليل يُرفض fail-closed", async () => {
    const sink = memoryFileSink();
    await sink.writeFile("sessions/tombstones/abc.json", "ليس json صالحًا");
    await expect(readDiskTombstones(sink, "sessions")).rejects.toBeInstanceOf(TombstoneSetError);
  });
});
