import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UiText, uiText } from "./UiText";
import { useUiText } from "./useUiText";
import { DEFAULT_LOCALE } from "./types";

afterEach(() => {
  act(() => {
    uiText.setLocale(DEFAULT_LOCALE);
  });
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
});

describe("UiText.t", () => {
  it("starts in Arabic (D2) and interpolates named arguments", () => {
    expect(uiText.t("chat.send")).toBe("إرسال");
    expect(uiText.t("chat.modelsFetchFailed", { detail: "503" })).toContain("503");
  });

  it("leaves a placeholder without an argument untouched", () => {
    expect(uiText.t("chat.modelsFetchFailed")).toContain("{detail}");
  });

  it("switches catalogs when the locale changes", () => {
    const text = new UiText("en");
    expect(text.t("chat.send")).toBe("Send");
    text.setLocale("ar");
    expect(text.t("chat.send")).toBe("إرسال");
  });

  it("throws for a key that is not a plain string", () => {
    expect(() => uiText.t("chat.results" as never)).toThrow(/Missing text resource/);
  });
});

describe("UiText.plural", () => {
  const arabic: { count: number; expected: string; category: string }[] = [
    { count: 0, expected: "لا نتائج", category: "zero" },
    { count: 1, expected: "نتيجة واحدة", category: "one" },
    { count: 2, expected: "نتيجتان", category: "two" },
    { count: 3, expected: "3 نتائج", category: "few" },
    { count: 10, expected: "10 نتائج", category: "few" },
    { count: 11, expected: "11 نتيجة", category: "many" },
    { count: 99, expected: "99 نتيجة", category: "many" },
    { count: 100, expected: "100 نتيجة", category: "other" },
    { count: 103, expected: "103 نتائج", category: "few" },
  ];

  it.each(arabic)("renders $count with the $category category", ({ count, expected }) => {
    uiText.setLocale("ar");
    expect(uiText.plural("chat.results", count)).toBe(expected);
  });

  it("uses only the two English categories", () => {
    uiText.setLocale("en");
    expect(uiText.plural("chat.results", 0)).toBe("0 results");
    expect(uiText.plural("chat.results", 1)).toBe("1 result");
    expect(uiText.plural("chat.results", 2)).toBe("2 results");
    expect(uiText.plural("chat.results", 11)).toBe("11 results");
  });

  it("exposes count to the template and merges extra arguments", () => {
    uiText.setLocale("ar");
    expect(uiText.plural("chat.results", 7, { detail: "ignored" })).toBe("7 نتائج");
  });

  it("throws for a key that is not a plural", () => {
    expect(() => uiText.plural("chat.send" as never, 1)).toThrow(/Missing plural resource/);
  });
});

describe("UiText formatting", () => {
  it("keeps Latin digits under Arabic (D1)", () => {
    uiText.setLocale("ar");
    expect(uiText.formatNumber(1234.5)).toBe("1,234.5");
    expect(uiText.formatNumber(1234.5)).not.toMatch(/[\u0660-\u0669\u06F0-\u06F9]/);
  });

  it("honours explicit options", () => {
    uiText.setLocale("ar");
    expect(uiText.formatNumber(1234.5, { maximumFractionDigits: 0 })).toBe("1,235");
  });

  it("formats dates with Latin digits and without the Arabic-Indic range", () => {
    uiText.setLocale("ar");
    const formatted = uiText.formatDate(Date.UTC(2026, 0, 2), {
      year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC",
    });
    expect(formatted).toContain("2026");
    expect(formatted).not.toMatch(/[\u0660-\u0669]/);
  });

  it("formats times the same way in both locales", () => {
    const options = { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" } as const;
    uiText.setLocale("ar");
    const arabic = uiText.formatDate(Date.UTC(2026, 0, 2, 15, 4, 5), options);
    uiText.setLocale("en");
    const english = uiText.formatDate(Date.UTC(2026, 0, 2, 15, 4, 5), options);
    expect(arabic).toBe("15:04:05");
    expect(english).toBe("15:04:05");
  });

  it("formats units for the active locale", () => {
    uiText.setLocale("en");
    expect(uiText.formatUnit(5, "second", { unitDisplay: "narrow" })).toBe("5s");
    uiText.setLocale("ar");
    expect(uiText.formatUnit(5, "second", { unitDisplay: "narrow" })).toBe("5 ث");
  });
});

describe("UiText direction", () => {
  it("drives lang and dir on the document root", () => {
    uiText.setLocale("en");
    expect(document.documentElement.getAttribute("dir")).toBe("ltr");
    expect(document.documentElement.getAttribute("lang")).toBe("en");
    uiText.setLocale("ar");
    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
    expect(document.documentElement.getAttribute("lang")).toBe("ar");
  });

  it("notifies subscribers only on an actual change", () => {
    const listener = vi.fn();
    const unsubscribe = uiText.subscribe(listener);
    uiText.setLocale(DEFAULT_LOCALE);
    expect(listener).not.toHaveBeenCalled();
    uiText.setLocale("en");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    uiText.setLocale("ar");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("useUiText", () => {
  it("re-renders consumers when the locale changes", () => {
    const { result } = renderHook(() => useUiText());
    expect(result.current.t("chat.send")).toBe("إرسال");
    act(() => {
      uiText.setLocale("en");
    });
    expect(result.current.t("chat.send")).toBe("Send");
    expect(result.current.getLocale()).toBe("en");
  });

  it("exposes destructure-safe bound helpers", () => {
    const { t, plural } = uiText;
    uiText.setLocale("ar");
    expect(t("chat.send")).toBe("إرسال");
    expect(plural("chat.results", 2)).toBe("نتيجتان");
  });
});
