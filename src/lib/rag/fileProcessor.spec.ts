import { beforeEach, describe, expect, it, vi } from "vitest";

// pdfjs-dist is mocked in src/test/setup.ts with an empty document; this
// file-level factory provides a configurable document so the page loop runs.
const pdf = vi.hoisted(() => ({
  numPages: 0,
  items: [] as Array<Record<string, unknown>>,
  getDocumentArgs: [] as unknown[],
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: (...args: unknown[]) => {
    pdf.getDocumentArgs.push(args);
    return {
      promise: Promise.resolve({
        numPages: pdf.numPages,
        getPage: async () => ({ getTextContent: async () => ({ items: pdf.items }) }),
      }),
    };
  },
}));

vi.mock("./docxExtractor", () => ({
  extractDocxText: vi.fn(async () => ({ text: "docx-content", metadata: {} })),
}));

import {
  detectFileType,
  extractText,
  formatFileSize,
  getFileTypeLabel,
  isSupportedFileType,
} from "./fileProcessor";

beforeEach(() => {
  pdf.numPages = 0;
  pdf.items = [];
  pdf.getDocumentArgs = [];
});

describe("detectFileType", () => {
  it("يتعرّف على الامتدادات المدعومة", () => {
    expect(detectFileType("a.txt")).toBe("txt");
    expect(detectFileType("a.md")).toBe("md");
    expect(detectFileType("a.markdown")).toBe("md");
    expect(detectFileType("a.json")).toBe("json");
    expect(detectFileType("a.csv")).toBe("csv");
    expect(detectFileType("a.log")).toBe("log");
    expect(detectFileType("a.pdf")).toBe("pdf");
    expect(detectFileType("a.docx")).toBe("docx");
  });

  it("يتجاهل حالة الأحرف", () => {
    expect(detectFileType("REPORT.PDF")).toBe("pdf");
    expect(detectFileType("Notes.MD")).toBe("md");
  });

  it("يعيد unknown للامتدادات غير المدعومة أو الملفات بلا امتداد", () => {
    expect(detectFileType("a.xyz")).toBe("unknown");
    expect(detectFileType("README")).toBe("unknown");
    expect(detectFileType("")).toBe("unknown");
  });

  it("يأخذ الامتداد الأخير فقط", () => {
    expect(detectFileType("archive.tar.gz")).toBe("unknown");
    expect(detectFileType("data.backup.txt")).toBe("txt");
  });
});

describe("isSupportedFileType", () => {
  it("يقبل الأنواع المدعومة ويرفض غيرها", () => {
    expect(isSupportedFileType("a.txt")).toBe(true);
    expect(isSupportedFileType("a.pdf")).toBe(true);
    expect(isSupportedFileType("a.docx")).toBe(true);
  });
});

describe("extractText", () => {
  it("يقرأ الملفات النصية كما هي", async () => {
    const file = new File(["مرحبا بالعالم"], "a.txt");

    const result = await extractText(file, "a.txt");

    expect(result.text).toBe("مرحبا بالعالم");
    expect(result.metadata).toEqual({});
  });

  it("يعالج md و json و csv و log عبر المسار النصي نفسه", async () => {
    for (const name of ["a.md", "a.json", "a.csv", "a.log"]) {
      const file = new File(["content"], name);
      const result = await extractText(file, name);
      expect(result.text).toBe("content");
    }
  });

  it("يرمي خطأ للأنواع غير المدعومة", async () => {
    const file = new File(["x"], "a.xyz");

    await expect(extractText(file, "a.xyz")).rejects.toThrow(
      "Unsupported file type: unknown",
    );
  });

  it("يوجّه ملفات docx إلى مستخرج DOCX", async () => {
    const file = new File(["docx"], "a.docx");

    const result = await extractText(file, "a.docx");

    expect(result.text).toBe("docx-content");
    expect(result.metadata).toEqual({});
  });

  it("يستخرج نص PDF ويرقّم الصفحات", async () => {
    pdf.numPages = 2;
    pdf.items = [{ str: "hello" }, { str: "world" }];

    const result = await extractText(new File(["pdf"], "doc.pdf"), "doc.pdf");

    expect(result.text).toBe("hello world\n\nhello world\n\n");
    expect(result.metadata).toEqual({ pageCount: 2, pageNumbers: [1, 2] });
    expect(pdf.getDocumentArgs).toHaveLength(1);
  });

  it("يتجاهل عناصر PDF التي لا تحتوي على خاصية str", async () => {
    pdf.numPages = 1;
    pdf.items = [{ str: "hello" }, { type: "marked-content" }];

    const result = await extractText(new File(["pdf"], "doc.pdf"), "doc.pdf");

    expect(result.text).toBe("hello \n\n");
    expect(result.metadata).toEqual({ pageCount: 1, pageNumbers: [1] });
  });

  it("يعيد نصًا فارغًا لمستند PDF بلا صفحات", async () => {
    pdf.numPages = 0;

    const result = await extractText(new File(["pdf"], "empty.pdf"), "empty.pdf");

    expect(result.text).toBe("");
    expect(result.metadata).toEqual({ pageCount: 0, pageNumbers: [] });
  });

  it("يضبط رابط عامل pdfjs قبل الاستخراج", async () => {
    pdf.numPages = 1;
    const pdfjs = await import("pdfjs-dist");

    await extractText(new File(["pdf"], "doc.pdf"), "doc.pdf");

    expect(pdfjs.GlobalWorkerOptions.workerSrc).toContain("pdf.worker.min.mjs");
  });
});

describe("getFileTypeLabel", () => {
  it("يعيد التسميات المعروفة", () => {
    expect(getFileTypeLabel("pdf")).toBe("PDF");
    expect(getFileTypeLabel("md")).toBe("Markdown");
    expect(getFileTypeLabel("txt")).toBe("Text");
    expect(getFileTypeLabel("json")).toBe("JSON");
    expect(getFileTypeLabel("csv")).toBe("CSV");
    expect(getFileTypeLabel("log")).toBe("Log");
  });

  it("يعيد النوع بأحرف كبيرة للأنواع المجهولة", () => {
    expect(getFileTypeLabel("docx")).toBe("DOCX");
    expect(getFileTypeLabel("session")).toBe("SESSION");
  });
});

describe("formatFileSize", () => {
  it("ينسّق البايتات والكيلوبايتات والميغابايتات", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(1023)).toBe("1023 B");
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(1024 * 1024 - 1)).toBe("1024.0 KB");
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
