import { describe, expect, it } from "vitest";
import { summarizeRagStatus } from "./RagStatusChip";
import type { RagDocument, RagFolder } from "@/types";

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
    expect(s.label).toContain("2");
  });
});
