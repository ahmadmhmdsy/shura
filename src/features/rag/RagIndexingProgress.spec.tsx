import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RagIndexingProgress } from "./RagIndexingProgress";
import { useRagStore } from "@/state/ragStore";

const seedProgress = (
  over: Partial<ReturnType<typeof useRagStore.getState>["indexingProgress"]> = {},
) => {
  useRagStore.setState((s) => ({
    indexingProgress: { ...s.indexingProgress, ...over },
  }));
};

beforeEach(() => {
  seedProgress({ totalFiles: 0, completedFiles: 0, currentFile: "" });
});

describe("RagIndexingProgress", () => {
  it("يعرض صفر بالمئة عندما لا توجد ملفات", () => {
    render(<RagIndexingProgress />);

    expect(screen.getByText("0%")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("يحسب النسبة من الملفات المكتملة", () => {
    seedProgress({ totalFiles: 4, completedFiles: 2, currentFile: "doc.pdf" });
    render(<RagIndexingProgress />);

    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  });

  it("يقرّب النسبة لأقرب عدد صحيح", () => {
    seedProgress({ totalFiles: 3, completedFiles: 1 });
    render(<RagIndexingProgress />);

    expect(screen.getByText("33%")).toBeTruthy();
  });

  it("الضغط على الشريط يعرض التفاصيل ثم يخفيها", () => {
    seedProgress({ totalFiles: 4, completedFiles: 2, currentFile: "doc.pdf" });
    render(<RagIndexingProgress />);

    const toggle = screen.getByRole("button");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/إجمالي الملفات/)).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("إجمالي الملفات: 4")).toBeTruthy();
    expect(screen.getByText("مكتمل: 2")).toBeTruthy();
    expect(screen.getByText("الملف الحالي: doc.pdf")).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/إجمالي الملفات/)).toBeNull();
  });

  it("لا يعرض الملف الحالي عند غيابه", () => {
    seedProgress({ totalFiles: 2, completedFiles: 1, currentFile: "" });
    render(<RagIndexingProgress />);

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("إجمالي الملفات: 2")).toBeTruthy();
    expect(screen.getByText("مكتمل: 1")).toBeTruthy();
    expect(screen.queryByText(/الملف الحالي/)).toBeNull();
  });
});
