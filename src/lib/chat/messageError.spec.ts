import { afterEach, describe, expect, it } from "vitest";
import { uiText } from "@/i18n";
import { en } from "@/i18n/en";
import { ar } from "@/i18n/ar";
import { INTERRUPTED_TURN_ERROR } from "@/lib/db/repos/attempts";
import { messageErrorText } from "./messageError";

// [T3.1/D6] القيمة المخزَّنة عقدٌ محفوظ: الخريطة تترجم عند العرض، ولا تلمس الصفّ ولا التصدير.
describe("messageErrorText (T3.1/D6)", () => {
  afterEach(() => uiText.setLocale("ar"));

  it("القيمة المخزَّنة المعروفة تُترجَم في اللغتين", () => {
    uiText.setLocale("en");
    expect(messageErrorText(uiText.t, INTERRUPTED_TURN_ERROR)).toBe(en.errors.interruptedTurn);
    uiText.setLocale("ar");
    expect(messageErrorText(uiText.t, INTERRUPTED_TURN_ERROR)).toBe(ar.errors.interruptedTurn);
  });

  it("النسخة العربية مطابقة بايتًا للقيمة المخزَّنة، فلا يتغيّر ما يراه المستخدم العربي", () => {
    expect(ar.errors.interruptedTurn).toBe(INTERRUPTED_TURN_ERROR);
  });

  it("قيمة مخزَّنة غير معروفة تُعرض كما هي ولا تصير فارغة", () => {
    uiText.setLocale("en");
    expect(messageErrorText(uiText.t, "فشل تخزين داخلي")).toBe("فشل تخزين داخلي");
    expect(messageErrorText(uiText.t, "401 Unauthorized")).toBe("401 Unauthorized");
  });

  it("غياب الخطأ يعيد نصًا فارغًا", () => {
    expect(messageErrorText(uiText.t, undefined)).toBe("");
    expect(messageErrorText(uiText.t, null)).toBe("");
    expect(messageErrorText(uiText.t, "")).toBe("");
  });
});

// [T3.2a] قيم الفئة الثانية المخزَّنة: الصفّ يبقى بايتًا كما هو، والعرض يترجم المعروف فقط.
describe("messageErrorText (T3.2a)", () => {
  afterEach(() => uiText.setLocale("ar"));

  it("يترجم خطأ حفظ النتيجة الأساسية وخطأ إلغاء النداء في الإنجليزية", () => {
    uiText.setLocale("en");
    expect(messageErrorText(uiText.t, "تعذر حفظ النتيجة الأساسية")).toBe(en.errors.resultSaveFailed);
    expect(messageErrorText(uiText.t, "أُلغي النداء")).toBe(en.errors.callCancelled);
  });

  it("يبقى النص العربي مطابقًا بايتًا للقيمة المخزَّنة", () => {
    expect(ar.errors.resultSaveFailed).toBe("تعذر حفظ النتيجة الأساسية");
    expect(ar.errors.callCancelled).toBe("أُلغي النداء");
    expect(messageErrorText(uiText.t, "تعذر حفظ النتيجة الأساسية")).toBe("تعذر حفظ النتيجة الأساسية");
    expect(messageErrorText(uiText.t, "أُلغي النداء")).toBe("أُلغي النداء");
  });
});
