import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "./empty-state";

describe("حالة الفراغ", () => {
  it("يعرض العنوان والوصف والأيقونة والإجراء", () => {
    render(
      <EmptyState
        title="لا توجد جلسات"
        description="ابدأ بإنشاء جلسة جديدة"
        icon={<span>أيقونة</span>}
        action={<button type="button">إنشاء جلسة</button>}
      />
    );
    expect(screen.getByText("لا توجد جلسات")).toBeTruthy();
    expect(screen.getByText("ابدأ بإنشاء جلسة جديدة")).toBeTruthy();
    expect(screen.getByText("أيقونة")).toBeTruthy();
    expect(screen.getByRole("button", { name: "إنشاء جلسة" })).toBeTruthy();
  });

  it("يعرض العنوان فقط عند عدم تمرير الوصف أو الإجراء", () => {
    render(<EmptyState title="فارغ" />);
    expect(screen.getByText("فارغ")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
