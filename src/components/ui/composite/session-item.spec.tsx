import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionItem, type SessionItemProps } from "./session-item";

function renderItem(overrides: Partial<SessionItemProps> = {}) {
  const onSelect = vi.fn();
  const onRename = vi.fn();
  const onDelete = vi.fn();
  const props: SessionItemProps = {
    id: "s1",
    title: "جلسة العمل",
    messageCount: 3,
    lastMessage: "آخر رسالة",
    onSelect,
    onRename,
    onDelete,
    ...overrides,
  };
  render(<SessionItem {...props} />);
  return { onSelect, onRename, onDelete };
}

describe("عنصر الجلسة", () => {
  it("يعرض العنوان وعدد الرسائل وآخر رسالة", () => {
    renderItem();
    expect(screen.getByText("جلسة العمل")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("آخر رسالة")).toBeTruthy();
  });

  it("ينفّذ onSelect عند النقر على العنصر", async () => {
    const { onSelect } = renderItem();
    await userEvent.click(screen.getByText("جلسة العمل"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("ينفّذ onSelect عند الضغط على Enter", async () => {
    const { onSelect } = renderItem();
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("ينفّذ onRename عند النقر على زر إعادة التسمية", async () => {
    const { onRename } = renderItem();
    await userEvent.click(screen.getByRole("button", { name: "إعادة تسمية" }));
    expect(onRename).toHaveBeenCalledWith("جلسة العمل");
  });

  it("ينفّذ onDelete عند النقر على زر الحذف", async () => {
    const { onDelete } = renderItem();
    await userEvent.click(screen.getByRole("button", { name: "حذف" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("يعرض حقل الإدخال عند isEditing وينفّذ onRename عند الإدخال", async () => {
    const onRename = vi.fn();
    renderItem({ isEditing: true, onRename });
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "عنوان جديد" } });
    await userEvent.tab();
    expect(onRename).toHaveBeenCalledWith("عنوان جديد");
  });

  it("يعيد العنوان الأصلي عند الضغط على Escape", async () => {
    const onRename = vi.fn();
    renderItem({ isEditing: true, onRename });
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "عنوان جديد" } });
    await userEvent.keyboard("{Escape}");
    expect(onRename).toHaveBeenCalledWith("جلسة العمل");
  });

  it("لا يعرض عدد الرسائل عندما يكون صفرًا", () => {
    renderItem({ messageCount: 0 });
    expect(screen.queryByText("3")).toBeNull();
  });
});
