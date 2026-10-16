import { afterEach, describe, expect, it } from "vitest";
import { LIMITS, clampTimeoutMs, isWithinLimit, limitError } from "./limits";
import { errorText, isKeyedError } from "./errors/keyedError";
import { ar, en, uiText } from "@/i18n";

const originalLocale = uiText.getLocale();
afterEach(() => uiText.setLocale(originalLocale));

describe("hard limits", () => {
  it("declares the documented ceilings", () => {
    expect(LIMITS).toEqual({
      apiKeyMax: 512,
      sharedPromptMax: 100_000,
      customPromptMax: 100_000,
      timeoutMinMs: 10_000,
      timeoutMaxMs: 300_000,
      responseMaxChars: 1_000_000,
      archiveMaxChars: 2_000_000,
    });
  });

  it("clamps a timeout into the allowed range", () => {
    expect(clampTimeoutMs(1)).toBe(LIMITS.timeoutMinMs);
    expect(clampTimeoutMs(0)).toBe(LIMITS.timeoutMinMs);
    expect(clampTimeoutMs(-5000)).toBe(LIMITS.timeoutMinMs);
    expect(clampTimeoutMs(10_000_000)).toBe(LIMITS.timeoutMaxMs);
    expect(clampTimeoutMs(120_000)).toBe(120_000);
  });

  it("clamps a non-finite timeout to the minimum instead of storing NaN", () => {
    expect(clampTimeoutMs(Number.NaN)).toBe(LIMITS.timeoutMinMs);
    expect(clampTimeoutMs(Number.POSITIVE_INFINITY)).toBe(LIMITS.timeoutMinMs);
  });

  it("accepts a value exactly at the limit and rejects one past it", () => {
    expect(isWithinLimit("a".repeat(LIMITS.apiKeyMax), LIMITS.apiKeyMax)).toBe(true);
    expect(isWithinLimit("a".repeat(LIMITS.apiKeyMax + 1), LIMITS.apiKeyMax)).toBe(false);
  });

  it("produces a bounded keyed error that names the field and the ceiling", () => {
    const error = limitError("نص الطلب", LIMITS.sharedPromptMax);
    expect(isKeyedError(error)).toBe(true);
    expect(error.key).toBe("errors.limitExceeded");
    const message = errorText(uiText.t, error);
    expect(message).toContain("نص الطلب");
    expect(message).toContain("100000");
    expect(message.length).toBeLessThanOrEqual(120);
  });

  it("renders the limit error in the active locale, not in the producer's", () => {
    const error = limitError("نص الطلب", LIMITS.sharedPromptMax);
    expect(errorText(uiText.t, error)).toBe(ar.errors.limitExceeded.replace("{field}", "نص الطلب").replace("{max}", "100000"));
    uiText.setLocale("en");
    expect(errorText(uiText.t, error)).toBe(en.errors.limitExceeded.replace("{field}", "نص الطلب").replace("{max}", "100000"));
  });
});
