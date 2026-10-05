import { beforeEach, describe, expect, it, vi } from "vitest";

const mammoth = vi.hoisted(() => ({ extractRawText: vi.fn() }));

vi.mock("mammoth", () => ({
  extractRawText: (...args: unknown[]) => mammoth.extractRawText(...args),
}));

import { extractDocxText, isDocxSupported } from "./docxExtractor";

beforeEach(() => {
  mammoth.extractRawText.mockReset();
});

describe("extractDocxText", () => {
  it("يستخرج النص عبر mammoth ويمرّر arrayBuffer", async () => {
    mammoth.extractRawText.mockResolvedValue({ value: "نص المستند" });

    const result = await extractDocxText(new File(["docx"], "a.docx"));

    expect(result).toEqual({ text: "نص المستند", metadata: {} });
    expect(mammoth.extractRawText).toHaveBeenCalledTimes(1);
    const args = mammoth.extractRawText.mock.calls[0][0] as { arrayBuffer: ArrayBuffer };
    expect(args.arrayBuffer).toBeInstanceOf(ArrayBuffer);
  });

  it("يعيد نصًا فارغًا عندما لا يجد mammoth نصًا", async () => {
    mammoth.extractRawText.mockResolvedValue({ value: "" });

    const result = await extractDocxText(new File(["docx"], "empty.docx"));

    expect(result.text).toBe("");
  });

  it("يمرّر فشل mammoth كما هو", async () => {
    mammoth.extractRawText.mockRejectedValue(new Error("corrupt docx"));

    await expect(extractDocxText(new File(["docx"], "bad.docx"))).rejects.toThrow("corrupt docx");
  });

  it("يعمل مع Blob لا مع File فقط", async () => {
    mammoth.extractRawText.mockResolvedValue({ value: "blob" });

    const result = await extractDocxText(new Blob(["docx"]));

    expect(result.text).toBe("blob");
  });
});

describe("isDocxSupported", () => {
  it("يعيد true دائمًا", () => {
    expect(isDocxSupported()).toBe(true);
  });
});
