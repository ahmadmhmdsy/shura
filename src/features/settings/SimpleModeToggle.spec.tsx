import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SimpleModeToggle } from "./SimpleModeToggle";
import { useSettingsStore } from "@/state/settingsStore";

describe("SimpleModeToggle", () => {
  beforeEach(() => {
    useSettingsStore.setState({ simpleMode: false });
  });

  it("يعرض العنوان والمفتاح بحالته الحالية", () => {
    render(<SimpleModeToggle />);
    expect(screen.getByText("وضع بسيط")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "وضع بسيط" })).not.toBeChecked();
  });

  it("المفتاح مفعّل عندما يكون simpleMode محفوظًا", () => {
    useSettingsStore.setState({ simpleMode: true });
    render(<SimpleModeToggle />);
    expect(screen.getByRole("switch", { name: "وضع بسيط" })).toBeChecked();
  });

  it("النقر على المفتاح يبدّل simpleMode في المخزن", () => {
    render(<SimpleModeToggle />);
    fireEvent.click(screen.getByRole("switch", { name: "وضع بسيط" }));
    expect(useSettingsStore.getState().simpleMode).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "وضع بسيط" }));
    expect(useSettingsStore.getState().simpleMode).toBe(false);
  });
});
