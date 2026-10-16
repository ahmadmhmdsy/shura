import { describe, expect, it } from "vitest";
import { summarizeRagStatus } from "./RagStatusChip";
import type { RagDocument } from "@/types";

const doc = (over: Partial<RagDocument>): RagDocument => ({
  id: "d", source: "upload", persistence: "persistent", fileName: "f", fileType: "pdf",
  fileSize: 1, status: "indexed", uploadedAt: 0, chunkCount: 0, embeddingModelId: "m", ...over,
});

describe("summarizeRagStatus", () => {
  it("لا توجد ملفات مفهرسة عندما يكون كل شيء فارغًا", () => {
    expect(summarizeRagStatus([], []).tone).toBe("muted");
  });
  it("جارٍ الفهرسة عندما يوجد مستند قيد الفهرسة", () => {
    expect(summarizeRagStatus([doc({ status: "indexing" })], []).tone).toBe("active");
  });
  it("تحذير عند وجود أخطاء", () => {
    expect(summarizeRagStatus([doc({ status: "error" })], []).tone).toBe("warn");
  });
  it("عدد الملفات المفهرسة عند عدم وجود نشاط", () => {
    const s = summarizeRagStatus([doc({ status: "indexed" }), doc({ status: "indexed" })], []);
    expect(s.tone).toBe("ok");
    expect(s.label).toBe("ملفان مفهران");
  });
  it("يحذّر من القطع القديمة حتى لو بدت الملفات مفهرسة", () => {
    const s = summarizeRagStatus(
      [doc({ status: "indexed" }), doc({ status: "indexed" })],
      [],
      {},
      3,
    );
    expect(s.tone).toBe("warn");
    expect(s.label).toBe("3 ملفات تحتاج إعادة فهرسة");
  });
  it("الفهرسة الجارية والخطأ يسبقان التحذير من القطع القديمة", () => {
    expect(summarizeRagStatus([doc({ status: "indexing" })], [], {}, 3).tone).toBe("active");
    expect(summarizeRagStatus([doc({ status: "error" })], [], {}, 3).label).not.toContain("إعادة");
  });
});
