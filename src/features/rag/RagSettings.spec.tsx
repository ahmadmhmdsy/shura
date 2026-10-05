import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RagSettings } from "./RagSettings";
import { useSettingsStore } from "@/state/settingsStore";
import { DEFAULT_RAG_SETTINGS } from "@/types";
import { downloadModel } from "@/lib/rag/modelDownloader";
import { downloadRagData } from "@/lib/export/ragExporter";
import { importRagData } from "@/lib/export/ragImporter";
import { toast } from "sonner";

vi.mock("@/lib/rag/modelDownloader", () => ({ downloadModel: vi.fn() }));
vi.mock("@/lib/export/ragExporter", () => ({ downloadRagData: vi.fn() }));
vi.mock("@/lib/export/ragImporter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/export/ragImporter")>()),
  importRagData: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const seedSettings = (over: Partial<typeof DEFAULT_RAG_SETTINGS> = {}) => {
  useSettingsStore.setState({
    ragSettings: { ...DEFAULT_RAG_SETTINGS, ...over },
  });
};

const selects = () => screen.getAllByRole("combobox") as HTMLSelectElement[];
const sliders = () => screen.getAllByRole("slider") as HTMLInputElement[];

const jsonFile = (content: string, name = "rag.json") =>
  new File([content], name, { type: "application/json" });

const importInput = (container: HTMLElement) =>
  container.querySelector('input[type="file"]') as HTMLInputElement;

beforeEach(() => {
  seedSettings();
  vi.mocked(downloadModel).mockReset();
  vi.mocked(downloadRagData).mockReset();
  vi.mocked(importRagData).mockReset();
  vi.mocked(downloadModel).mockResolvedValue(undefined);
  vi.mocked(downloadRagData).mockResolvedValue(undefined);
  vi.mocked(importRagData).mockResolvedValue(undefined);
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RagSettings", () => {
  it("يعرض كل أقسام إعدادات البحث", () => {
    render(<RagSettings />);

    expect(screen.getByText("نموذج التضمين")).toBeTruthy();
    expect(screen.getByText("الإعداد المسبق")).toBeTruthy();
    expect(screen.getByText("حفظ الملفات المرفوعة")).toBeTruthy();
    expect(screen.getByText("حذف الملفات المؤقتة")).toBeTruthy();
    expect(screen.getByText("نمط البحث")).toBeTruthy();
    expect(screen.getByText("وضع البحث العميق")).toBeTruthy();
    expect(screen.getByText("إعادة فهرسة تلقائية")).toBeTruthy();
    expect(screen.getByText("تصدير بيانات البحث")).toBeTruthy();
    expect(screen.getByText("استيراد بيانات البحث")).toBeTruthy();
    expect(screen.getByText("متوازن (500/100)")).toBeTruthy();
    expect(screen.getByText("دقيق (300/50)")).toBeTruthy();
    expect(screen.getByText("سياقي (800/150)")).toBeTruthy();
    expect(screen.getByText("Multilingual E5 Small (recommended for Arabic)")).toBeTruthy();
    expect(screen.getByText("حجم القطعة: 500")).toBeTruthy();
    expect(screen.getByText("التداخل: 100")).toBeTruthy();
    expect(screen.getByText("عدد النتائج: 5")).toBeTruthy();
  });

  it("تغيير نموذج التضمين يحدّث الاختيار", () => {
    render(<RagSettings />);
    fireEvent.change(selects()[0], { target: { value: "all-MiniLM-L6-v2" } });
    expect(selects()[0]).toHaveValue("all-MiniLM-L6-v2");
  });

  it("أزرار الإعداد المسبق تضبط حجم القطعة والتداخل", () => {
    render(<RagSettings />);

    fireEvent.click(screen.getByText("دقيق (300/50)"));
    expect(screen.getByText("حجم القطعة: 300")).toBeTruthy();
    expect(screen.getByText("التداخل: 50")).toBeTruthy();

    fireEvent.click(screen.getByText("سياقي (800/150)"));
    expect(screen.getByText("حجم القطعة: 800")).toBeTruthy();
    expect(screen.getByText("التداخل: 150")).toBeTruthy();

    fireEvent.click(screen.getByText("متوازن (500/100)"));
    expect(screen.getByText("حجم القطعة: 500")).toBeTruthy();
    expect(screen.getByText("التداخل: 100")).toBeTruthy();
  });

  it("منزلق حجم القطعة يحدّث القيمة", () => {
    render(<RagSettings />);
    fireEvent.change(sliders()[0], { target: { value: "800" } });
    expect(screen.getByText("حجم القطعة: 800")).toBeTruthy();
  });

  it("منزلق التداخل يحدّث القيمة", () => {
    render(<RagSettings />);
    fireEvent.change(sliders()[1], { target: { value: "75" } });
    expect(screen.getByText("التداخل: 75")).toBeTruthy();
  });

  it("منزلق عدد النتائج يحدّث القيمة", () => {
    render(<RagSettings />);
    fireEvent.change(sliders()[2], { target: { value: "10" } });
    expect(screen.getByText("عدد النتائج: 10")).toBeTruthy();
  });

  it("اختيار حفظ الملفات يحدّث القيمة", () => {
    render(<RagSettings />);
    fireEvent.change(selects()[1], { target: { value: "temp" } });
    expect(selects()[1]).toHaveValue("temp");
  });

  it("اختيار حذف الملفات المؤقتة يحدّث القيمة", () => {
    render(<RagSettings />);
    fireEvent.change(selects()[2], { target: { value: "manual" } });
    expect(selects()[2]).toHaveValue("manual");
  });

  it("اختيار نمط البحث يحدّث القيمة", () => {
    render(<RagSettings />);
    fireEvent.change(selects()[3], { target: { value: "semantic" } });
    expect(selects()[3]).toHaveValue("semantic");
  });

  it("اختيار وضع البحث العميق يحدّث القيمة", () => {
    render(<RagSettings />);
    fireEvent.change(selects()[4], { target: { value: "toggle" } });
    expect(selects()[4]).toHaveValue("toggle");
  });

  it("مفتاح إعادة الفهرسة التلقائية يبدّل الحالة", async () => {
    const user = userEvent.setup();
    render(<RagSettings />);
    const toggle = screen.getByRole("switch");

    expect(toggle).toHaveAttribute("aria-checked", "true");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("زر تحميل النموذج يعرض التقدم ثم يعود لحالته", async () => {
    let resolveDownload: (() => void) | undefined;
    vi.mocked(downloadModel).mockImplementation((_modelId, onProgress) => {
      onProgress?.({ loaded: 512, total: 1024, percent: 50 });
      return new Promise<void>((resolve) => {
        resolveDownload = resolve;
      });
    });
    render(<RagSettings />);

    fireEvent.click(screen.getByText("تحميل النموذج"));

    await waitFor(() => expect(screen.getByText("جارٍ التحميل…")).toBeTruthy());
    expect(screen.getByText(/50%/)).toBeTruthy();
    expect(downloadModel).toHaveBeenCalledWith(
      "multilingual-e5-small",
      expect.any(Function),
    );

    resolveDownload?.();
    await waitFor(() => expect(screen.getByText("تحميل النموذج")).toBeTruthy());
    expect(screen.queryByText(/50%/)).toBeNull();
  });

  it("فشل تحميل النموذج يُسجَّل ويعيد الزر لحالته", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(downloadModel).mockRejectedValue(new Error("network"));
    render(<RagSettings />);

    fireEvent.click(screen.getByText("تحميل النموذج"));

    await waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith("Model download failed:", expect.any(Error)),
    );
    await waitFor(() => expect(screen.getByText("تحميل النموذج")).toBeTruthy());
  });

  it("زر تصدير البيانات يستدعي التصدير", () => {
    render(<RagSettings />);
    fireEvent.click(screen.getByText("تصدير البيانات"));
    expect(downloadRagData).toHaveBeenCalledTimes(1);
  });

  it("زر استيراد البيانات يفتح نافذة اختيار الملف", () => {
    render(<RagSettings />);
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByText("استيراد البيانات"));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("استيراد ملف صالح يستورد ويُظهر النجاح", async () => {
    const { container } = render(<RagSettings />);
    const valid = JSON.stringify({ documents: [], chunks: [], folders: [] });
    fireEvent.change(importInput(container), { target: { files: [jsonFile(valid)] } });

    await waitFor(() => expect(importRagData).toHaveBeenCalledTimes(1));
    expect(vi.mocked(toast.success).mock.calls[0][0]).toBe("تم الاستيراد بنجاح");
  });

  it("ملف غير صالح يُظهر خطأ الاستيراد", async () => {
    const { container } = render(<RagSettings />);
    fireEvent.change(importInput(container), {
      target: { files: [jsonFile("ليس json صالحًا")] },
    });

    await waitFor(() =>
      expect(vi.mocked(toast.error).mock.calls[0][0]).toBe(
        "فشل الاستيراد — تأكد من صحة الملف",
      ),
    );
    expect(importRagData).not.toHaveBeenCalled();
  });

  it("ملف بصيغة خاطئة يُرفض دون استيراد", async () => {
    const { container } = render(<RagSettings />);
    fireEvent.change(importInput(container), {
      target: { files: [jsonFile(JSON.stringify({ documents: "x" }))] },
    });

    await waitFor(() =>
      expect(vi.mocked(toast.error).mock.calls[0][0]).toBe(
        "فشل الاستيراد — تأكد من صحة الملف",
      ),
    );
    expect(importRagData).not.toHaveBeenCalled();
  });

  it("عدم اختيار ملف لا يفعل شيئًا", () => {
    const { container } = render(<RagSettings />);
    fireEvent.change(importInput(container), { target: { files: [] } });

    expect(importRagData).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
