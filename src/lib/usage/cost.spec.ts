import { describe, expect, it } from "vitest";
import { ar } from "@/i18n/ar";
import { en } from "@/i18n/en";
import { COST_DECIMALS, CURRENCY_MARK, UNKNOWN_COST, formatCost } from "./cost";

/** منسّق أرقام باللغة المطلوبة، كما يفعله `UiText.formatNumber`. */
const latin = (locale: string) => (value: number, options?: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat(locale, { numberingSystem: "latn", ...options }).format(value);

// [T3.4/LV-07] مساعد واحد لسلسلة التكلفة: أربع واجهات كانت تبنيه بنفسها
// (`"$" + toFixed(6)` وعلامة `"—"` مكتوبة في المكوّن).
describe("formatCost (T3.4/LV-07)", () => {
  it("سعر مجهول يعطي العلامة الممرَّرة لا صفرًا", () => {
    expect(formatCost(null, UNKNOWN_COST)).toBe(UNKNOWN_COST);
    expect(formatCost(undefined, UNKNOWN_COST)).toBe(UNKNOWN_COST);
    expect(formatCost(Number.NaN, UNKNOWN_COST)).toBe(UNKNOWN_COST);
    expect(formatCost(Number.POSITIVE_INFINITY, UNKNOWN_COST)).toBe(UNKNOWN_COST);
  });

  it("الصفر سعر حقيقي ولا يُعامل كسعر مجهول", () => {
    expect(formatCost(0, UNKNOWN_COST)).toBe(CURRENCY_MARK + "0.000000");
  });

  it("المسار الثابت لا يتحرك مع لغة الواجهة (بايتات الأرشيف والتصدير)", () => {
    expect(formatCost(0.0003, UNKNOWN_COST)).toBe("$0.000300");
    expect(formatCost(1234.5, UNKNOWN_COST)).toBe("$1234.500000");
  });

  it("مسار الواجهة يمرّ عبر منسّق الأرقام فيتبع اللغة", () => {
    expect(formatCost(0.0003, UNKNOWN_COST, latin("en"))).toBe("$0.000300");
    expect(formatCost(1234.5, UNKNOWN_COST, latin("ar"))).toBe("$1,234.500000");
  });

  it("علامة المجهول واحدة: الثابت المشترك = مورد الواجهة في اللغتين", () => {
    expect(en.common.noValue).toBe(UNKNOWN_COST);
    expect(ar.common.noValue).toBe(UNKNOWN_COST);
  });

  it("عدد الخانات ثابت ستًا في كل المسارات", () => {
    expect(COST_DECIMALS).toBe(6);
    expect(formatCost(0.1, UNKNOWN_COST)).toBe("$0.100000");
  });
});
