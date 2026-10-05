import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

function Bomb(): never {
  throw new Error("انفجار اختباري");
}

describe("ErrorBoundary", () => {
  it("يعرض المحتوى عند عدم وجود خطأ", () => {
    render(<ErrorBoundary><p>محتوى سليم</p></ErrorBoundary>);
    expect(screen.getByText("محتوى سليم")).toBeTruthy();
  });

  it("يعرض الواجهة البديلة مع رسالة الخطأ عند فشل أحد الأبناء", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("انفجار اختباري")).toBeTruthy();
    spy.mockRestore();
  });
});
