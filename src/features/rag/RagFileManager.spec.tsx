import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RagFileManager } from "./RagFileManager";
import { useRagStore } from "@/state/ragStore";
import { useSettingsStore } from "@/state/settingsStore";
import { DEFAULT_RAG_SETTINGS, type RagDocument } from "@/types";
import { cleanupTempDocuments, deleteDocument, indexDocument } from "@/lib/rag/documentManager";

// خطأ إنتاجي موثَّق: الفهرس "persistence" غير معرّف في مخطط rag_documents، لذا تُستبدل
// وحدة documentManager بالكامل بدل لمس المخطط — المكوّن يُختبَر عبر عقوده المرئية.
vi.mock("@/lib/rag/documentManager", () => ({
  indexDocument: vi.fn(),
  deleteDocument: vi.fn(),
  cleanupTempDocuments: vi.fn(),
}));

const doc = (over: Partial<RagDocument> = {}): RagDocument => ({
  id: "d1",
  source: "upload",
  persistence: "persistent",
  fileName: "تقرير.pdf",
  fileType: "pdf",
  fileSize: 2048,
  status: "indexed",
  uploadedAt: 0,
  chunkCount: 3,
  embeddingModelId: "multilingual-e5-small",
  ...over,
});

const seedDocs = (documents: RagDocument[]) => {
  useRagStore.setState({
    documents,
    refreshDocuments: vi.fn(async () => {}),
  });
};

const seedSettings = (over: Partial<typeof DEFAULT_RAG_SETTINGS> = {}) => {
  useSettingsStore.setState({
    ragSettings: { ...DEFAULT_RAG_SETTINGS, defaultPersistence: "ask", ...over },
  });
};

const txtFile = (name = "ملف.txt") => new File(["نص تجريبي"], name, { type: "text/plain" });

const fileInput = (container: HTMLElement) =>
  container.querySelector('input[type="file"]') as HTMLInputElement;

const dropZone = (container: HTMLElement) => fileInput(container)!.parentElement as HTMLElement;

beforeEach(() => {
  seedSettings();
  seedDocs([]);
  vi.mocked(indexDocument).mockReset();
  vi.mocked(deleteDocument).mockReset();
  vi.mocked(cleanupTempDocuments).mockReset();
  vi.mocked(indexDocument).mockResolvedValue(doc());
  vi.mocked(deleteDocument).mockResolvedValue(undefined);
  vi.mocked(cleanupTempDocuments).mockResolvedValue(0);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RagFileManager", () => {
  it("يعرض رسالة عدم وجود ملفات عند القائمة الفارغة", () => {
    const { container } = render(<RagFileManager />);
    expect(screen.getByText("لا توجد ملفات مفهرسة بعد")).toBeTruthy();
    expect(screen.queryByLabelText("حذف")).toBeNull();
    expect(screen.queryByText("حذف الملفات المؤقتة")).toBeNull();
    expect(container.querySelector('input[type="file"]')).toBeTruthy();
  });

  it("يعرض المستندات مع الحالة والحجم وعدد القطع", () => {
    seedDocs([
      doc({ id: "d1", status: "indexed", fileName: "تقرير.pdf", fileType: "pdf", fileSize: 2048, chunkCount: 3 }),
      doc({ id: "d2", status: "indexing", fileName: "مسودة.md", fileType: "md", fileSize: 512, chunkCount: 1 }),
      doc({ id: "d3", status: "error", fileName: "معطوب.txt", fileType: "txt", fileSize: 100, chunkCount: 0 }),
      doc({ id: "d4", status: "pending", fileName: "لاحقًا.csv", fileType: "csv", fileSize: 1024, chunkCount: 2 }),
      doc({ id: "d5", status: "indexed", persistence: "temp", fileName: "مؤقت.log", fileType: "log", fileSize: 10, chunkCount: 1 }),
    ]);
    render(<RagFileManager />);

    expect(screen.getByText("تقرير.pdf")).toBeTruthy();
    expect(screen.getByText("PDF · 2.0 KB · 3 قطع")).toBeTruthy();
    expect(screen.getByText("Markdown · 512 B · قطعة واحدة")).toBeTruthy();
    expect(screen.getByText("Text · 100 B · لا قطع")).toBeTruthy();
    expect(screen.getByText("CSV · 1.0 KB · قطعتان")).toBeTruthy();
    expect(screen.getByText("Log · 10 B · قطعة واحدة")).toBeTruthy();
    expect(screen.getAllByText("مفهرس")).toHaveLength(2);
    expect(screen.getByText("جارٍ الفهرسة…")).toBeTruthy();
    expect(screen.getByText("خطأ")).toBeTruthy();
    expect(screen.getByText("قيد الانتظار")).toBeTruthy();
    expect(screen.getByText("مؤقت")).toBeTruthy();
    expect(screen.getByText("حذف الملفات المؤقتة")).toBeTruthy();
  });

  it("زر الرفع يفتح نافذة اختيار الملفات", async () => {
    render(<RagFileManager />);
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByText("رفع ملف"));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("رفع ملف مدعوم يستدعي الفهرسة بالحفظ الدائم افتراضيًا", async () => {
    const { container } = render(<RagFileManager />);
    const file = txtFile();
    fireEvent.change(fileInput(container), { target: { files: [file] } });

    await waitFor(() =>
      expect(indexDocument).toHaveBeenCalledWith(
        file,
        expect.objectContaining({ persistence: "persistent" }),
      ),
    );
    expect(vi.mocked(indexDocument).mock.calls[0][0].name).toBe("ملف.txt");
  });

  it("رفع ملف يستدعي الفهرسة بالحفظ المؤقت عند اختياره في الإعدادات", async () => {
    seedSettings({ defaultPersistence: "temp" });
    const { container } = render(<RagFileManager />);
    fireEvent.change(fileInput(container), { target: { files: [txtFile()] } });

    await waitFor(() =>
      expect(indexDocument).toHaveBeenCalledWith(
        expect.any(File),
        expect.objectContaining({ persistence: "temp" }),
      ),
    );
  });

  it("يُرشّح الملفات غير المدعومة ويفهرس المدعومة فقط", async () => {
    const { container } = render(<RagFileManager />);
    const supported = txtFile("مدعوم.txt");
    fireEvent.change(fileInput(container), {
      target: { files: [supported, new File(["x"], "برنامج.exe")] },
    });

    await waitFor(() => expect(indexDocument).toHaveBeenCalledTimes(1));
    expect(vi.mocked(indexDocument).mock.calls[0][0].name).toBe("مدعوم.txt");
  });

  it("الملفات غير المدعومة بالكامل لا تُفهرس وتُظهر تنبيهًا", () => {
    const { container } = render(<RagFileManager />);
    const alertMock = vi.fn();
    vi.stubGlobal("alert", alertMock);
    fireEvent.change(fileInput(container), {
      target: { files: [new File(["x"], "برنامج.exe")] },
    });

    expect(alertMock).toHaveBeenCalledWith(
      "لا توجد ملفات مدعومة. الصيغ المدعومة: PDF, MD, TXT, JSON, CSV, LOG",
    );
    expect(indexDocument).not.toHaveBeenCalled();
  });

  it("إسقاط الملفات في منطقة الإسقاط يفهرسها", async () => {
    const { container } = render(<RagFileManager />);
    const zone = dropZone(container);
    const dropped = txtFile("مسقط.txt");

    fireEvent.dragOver(zone);
    fireEvent.dragLeave(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [dropped] } });

    await waitFor(() =>
      expect(indexDocument).toHaveBeenCalledWith(
        dropped,
        expect.objectContaining({ persistence: "persistent" }),
      ),
    );
  });

  it("حالة الرفع تظهر أثناء الفهرسة وتختفي بعدها", async () => {
    let resolveDownload: ((document: RagDocument) => void) | undefined;
    vi.mocked(indexDocument).mockImplementation(
      () =>
        new Promise<RagDocument>((resolve) => {
          resolveDownload = resolve;
        }),
    );
    const { container } = render(<RagFileManager />);
    fireEvent.change(fileInput(container), { target: { files: [txtFile()] } });

    await waitFor(() => expect(screen.getByText("جارٍ الرفع…")).toBeTruthy());
    resolveDownload?.(doc());
    await waitFor(() => expect(screen.getByText("رفع ملف")).toBeTruthy());
  });

  it("فشل الفهرسة يُسجَّل ويعيد الزر لحالته الطبيعية", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(indexDocument).mockRejectedValue(new Error("تعذّر الفهرسة"));
    const { container } = render(<RagFileManager />);
    fireEvent.change(fileInput(container), { target: { files: [txtFile()] } });

    await waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith("Upload failed:", expect.any(Error)),
    );
    await waitFor(() => expect(screen.getByText("رفع ملف")).toBeTruthy());
  });

  it("حذف مستند يستدعي الحذف بعد التأكيد", async () => {
    seedDocs([doc({ id: "d1" })]);
    const confirmMock = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmMock);
    render(<RagFileManager />);

    fireEvent.click(screen.getByLabelText("حذف"));

    await waitFor(() => expect(deleteDocument).toHaveBeenCalledWith("d1"));
    expect(confirmMock).toHaveBeenCalledWith('حذف "تقرير.pdf"؟');
    await waitFor(() =>
      expect(useRagStore.getState().refreshDocuments).toHaveBeenCalled(),
    );
  });

  it("إلغاء الحذف لا يحذف المستند", () => {
    seedDocs([doc({ id: "d1" })]);
    vi.stubGlobal("confirm", vi.fn(() => false));
    render(<RagFileManager />);

    fireEvent.click(screen.getByLabelText("حذف"));

    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it("زر حذف الملفات المؤقتة ينظّف ويُظهر العدد", async () => {
    seedDocs([doc({ id: "t1", persistence: "temp" })]);
    vi.mocked(cleanupTempDocuments).mockResolvedValue(2);
    const alertMock = vi.fn();
    vi.stubGlobal("alert", alertMock);
    render(<RagFileManager />);

    fireEvent.click(screen.getByText("حذف الملفات المؤقتة"));

    await waitFor(() => expect(cleanupTempDocuments).toHaveBeenCalled());
    expect(alertMock).toHaveBeenCalledWith("حُذف ملفان مؤقتان");
    await waitFor(() =>
      expect(useRagStore.getState().refreshDocuments).toHaveBeenCalled(),
    );
  });
});
