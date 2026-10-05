import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTheme } from "./useTheme";

describe("useTheme", () => {
  it("الافتراضي داكن دون قيمة محفوظة ويثبّت الصف على <html>", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("shura-theme")).toBe("dark");
  });

  it("يقرأ القيمة المحفوظة «فاتح»", () => {
    localStorage.setItem("shura-theme", "light");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("القيمة المحفوظة غير الصالحة تُتجاهل والداكن يبقى افتراضيًا", () => {
    localStorage.setItem("shura-theme", "blue");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("toggleTheme يبدّل بين الداكن والفاتح ويحدّث <html> والتخزين", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("shura-theme")).toBe("light");
    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("shura-theme")).toBe("dark");
  });
});
