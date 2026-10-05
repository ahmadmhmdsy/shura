import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./dropdown-menu";

function renderMenu() {
  const onSelect = vi.fn();
  const onCheckedChange = vi.fn();
  const onValueChange = vi.fn();
  render(
    <DropdownMenu>
      <DropdownMenuTrigger>افتح القائمة</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>عنوان القائمة</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={onSelect}>عنصر عادي</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={onSelect}>عنصر حذف</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={false} onCheckedChange={onCheckedChange}>عنصر اختيار</DropdownMenuCheckboxItem>
        <DropdownMenuRadioGroup value="a" onValueChange={onValueChange}>
          <DropdownMenuRadioItem value="a">خيار أ</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="b">خيار ب</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>قائمة فرعية</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>عنصر فرعي</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuShortcut>Ctrl+K</DropdownMenuShortcut>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  return { onSelect, onCheckedChange, onValueChange };
}

describe("القائمة المنسدلة", () => {
  it("تفتح القائمة عند النقر على الزناد وتعرض العناصر", async () => {
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: "افتح القائمة" }));
    expect(await screen.findByRole("menuitem", { name: "عنصر عادي" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "عنصر حذف" })).toBeTruthy();
    expect(screen.getByRole("menuitemcheckbox", { name: "عنصر اختيار" })).toBeTruthy();
    expect(screen.getAllByRole("menuitemradio").length).toBe(2);
    expect(screen.getByRole("menuitem", { name: "قائمة فرعية" })).toBeTruthy();
  });

  it("ينفّذ onSelect عند النقر على عنصر عادي", async () => {
    const { onSelect } = renderMenu();
    await userEvent.click(screen.getByRole("button", { name: "افتح القائمة" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "عنصر عادي" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("ينفّذ onCheckedChange عند النقر على عنصر الاختيار", async () => {
    const { onCheckedChange } = renderMenu();
    await userEvent.click(screen.getByRole("button", { name: "افتح القائمة" }));
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "عنصر اختيار" }));
    expect(onCheckedChange).toHaveBeenCalled();
  });

  it("ينفّذ onValueChange عند اختيار خيار من مجموعة الاختيار", async () => {
    const { onValueChange } = renderMenu();
    await userEvent.click(screen.getByRole("button", { name: "افتح القائمة" }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "خيار ب" }));
    expect(onValueChange).toHaveBeenCalledWith("b");
  });

  it("يعرض الفاصل والاختصار داخل القائمة", async () => {
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: "افتح القائمة" }));
    expect(await screen.findByText("Ctrl+K")).toBeTruthy();
    expect(screen.getByRole("separator")).toBeTruthy();
  });

  it("يعرض محتوى البوابة عند فتح القائمة", async () => {
    render(
      <DropdownMenu>
        <DropdownMenuPortal>
          <div>محتوى البوابة</div>
        </DropdownMenuPortal>
        <DropdownMenuTrigger>افتح</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>عنصر</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
    await userEvent.click(screen.getByRole("button", { name: "افتح" }));
    expect(await screen.findByText("محتوى البوابة")).toBeTruthy();
  });
});
