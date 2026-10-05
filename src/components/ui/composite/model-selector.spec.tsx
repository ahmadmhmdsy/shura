import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModelSelector, type ModelOption } from "./model-selector";

const models: ModelOption[] = [
  { id: "gpt", label: "GPT-4o", provider: "openai", contextLength: 128000 },
  { id: "free", label: "نموذج مجاني", provider: "local", isFree: true },
];

describe("محدد النموذج", () => {
  it("يعرض العنصر النائب عند عدم اختيار نموذج", () => {
    render(<ModelSelector models={models} />);
    expect(screen.getByText("اختر النموذج…")).toBeTruthy();
  });

  it("يفتح القائمة ويعرض النماذج عند النقر على الزر", async () => {
    render(<ModelSelector models={models} />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.getAllByRole("option").length).toBe(2);
  });

  it("ينفّذ onValueChange عند اختيار نموذج", async () => {
    const onValueChange = vi.fn();
    render(<ModelSelector models={models} onValueChange={onValueChange} />);
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(await screen.findByRole("option", { name: /GPT-4o/ }));
    expect(onValueChange).toHaveBeenCalledWith("gpt");
  });

  it("يعرض شارة مجاني للنموذج المجاني", async () => {
    render(<ModelSelector models={models} />);
    await userEvent.click(screen.getByRole("button"));
    expect(await screen.findByText("مجاني")).toBeTruthy();
  });

  it("يعرض رسالة عدم وجود نماذج عند تمرير قائمة فارغة", async () => {
    render(<ModelSelector models={[]} />);
    await userEvent.click(screen.getByRole("button"));
    expect(await screen.findByText("لا توجد نماذج متاحة")).toBeTruthy();
  });

  it("يعطل الزر عند تمرير disabled", () => {
    render(<ModelSelector models={models} disabled />);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("يعرض اسم النموذج المختار في الزر", () => {
    render(<ModelSelector models={models} value="gpt" />);
    expect(screen.getByRole("button")).toHaveTextContent("GPT-4o");
  });
});
