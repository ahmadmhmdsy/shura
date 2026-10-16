import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useSettingsStore } from "@/state/settingsStore";
import { uiText } from "@/i18n";

const originalSetLanguage = useSettingsStore.getState().setLanguage;

beforeEach(() => {
  useSettingsStore.setState({ language: "ar", setLanguage: originalSetLanguage, saving: false, error: null });
  uiText.setLocale("ar");
});

afterEach(() => {
  uiText.setLocale("ar");
  useSettingsStore.setState({ language: "ar", setLanguage: originalSetLanguage });
});

describe("LanguageSwitcher", () => {
  it("names every locale in its own language", () => {
    render(<LanguageSwitcher />);
    const select = screen.getByRole("combobox", { name: "اللغة" }) as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual(["English", "العربية"]);
  });

  it("applies the locale immediately and then persists it", async () => {
    const setLanguage = vi.fn().mockResolvedValue(undefined);
    useSettingsStore.setState({ setLanguage });
    render(<LanguageSwitcher />);
    fireEvent.change(screen.getByRole("combobox", { name: "اللغة" }), { target: { value: "en" } });
    expect(uiText.getLocale()).toBe("en");
    await waitFor(() => expect(setLanguage).toHaveBeenCalledWith("en"));
  });

  it("rolls the visible locale back when persisting fails", async () => {
    const setLanguage = vi.fn().mockRejectedValue(new Error("write failed"));
    useSettingsStore.setState({ setLanguage });
    render(<LanguageSwitcher />);
    fireEvent.change(screen.getByRole("combobox", { name: "اللغة" }), { target: { value: "en" } });
    await waitFor(() => expect(uiText.getLocale()).toBe("ar"));
  });

  it("does nothing when the active locale is chosen again", () => {
    const setLanguage = vi.fn().mockResolvedValue(undefined);
    useSettingsStore.setState({ setLanguage });
    render(<LanguageSwitcher variant="compact" />);
    fireEvent.change(screen.getByRole("combobox", { name: "اللغة" }), { target: { value: "ar" } });
    expect(setLanguage).not.toHaveBeenCalled();
    expect(uiText.getLocale()).toBe("ar");
  });
});
