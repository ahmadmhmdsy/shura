import { afterEach, describe, expect, it } from "vitest";
import { KeyedError, errorText, isKeyedError } from "./keyedError";
import { ar, en, uiText } from "@/i18n";

const originalLocale = uiText.getLocale();
afterEach(() => uiText.setLocale(originalLocale));

describe("errorText - the one boundary translator (T3.2b)", () => {
  it("renders a keyed error in the active locale while the message stays the key", () => {
    const error = new KeyedError("errors.apiKeyTooLong");
    expect(isKeyedError(error)).toBe(true);
    expect(error.name).toBe("KeyedError");
    // The key, not the Arabic text, is what a log or a stack trace carries.
    expect(error.message).toBe("errors.apiKeyTooLong");
    expect(errorText(uiText.t, error)).toBe(ar.errors.apiKeyTooLong);
    uiText.setLocale("en");
    expect(errorText(uiText.t, error)).toBe(en.errors.apiKeyTooLong);
  });

  it("interpolates the args of a keyed error", () => {
    const error = new KeyedError("errors.limitExceeded", { field: "نص الطلب", max: 100_000 });
    expect(errorText(uiText.t, error)).toContain("نص الطلب");
    expect(errorText(uiText.t, error)).toContain("100000");
    uiText.setLocale("en");
    expect(errorText(uiText.t, error)).toContain("exceeds");
  });

  it("keeps the message of an unkeyed error and returns a plain string unchanged", () => {
    expect(errorText(uiText.t, new Error("قرص ممتلئ"))).toBe("قرص ممتلئ");
    expect(errorText(uiText.t, "مباشر")).toBe("مباشر");
    expect(isKeyedError(new Error("x"))).toBe(false);
  });

  it("reads a message-shaped object and never renders blank", () => {
    expect(errorText(uiText.t, { message: "تعذر الجلب" })).toBe("تعذر الجلب");
    expect(errorText(uiText.t, new Error(""))).toBe(ar.errors.unexpected);
    expect(errorText(uiText.t, null)).toBe(ar.errors.unexpected);
    expect(errorText(uiText.t, undefined)).toBe(ar.errors.unexpected);
    expect(errorText(uiText.t, "")).toBe(ar.errors.unexpected);
    expect(errorText(uiText.t, { statusCode: 500 })).toBe(ar.errors.unexpected);
  });
});
