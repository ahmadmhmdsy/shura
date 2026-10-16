import { describe, expect, it } from "vitest";
import { ASSUMED_CONTEXT_LIMIT, resolveContextLimit } from "./contextLimit";

describe("resolveContextLimit", () => {
  it("حد منشور صالح يُعاد كما هو بلا افتراض", () => {
    expect(resolveContextLimit({ contextLength: 200_000 })).toEqual({ limit: 200_000, assumed: false });
  });

  it("غياب الحد يعني الحد المفترض الواحد مع علامة افتراض", () => {
    expect(resolveContextLimit({})).toEqual({ limit: ASSUMED_CONTEXT_LIMIT, assumed: true });
  });

  // القيمة المشوّهة ليست حدًا صالحًا: تُعامل كغياب فلا يكسر الدور خطأ «حد السياق غير صالح».
  it("قيمة مشوّهة (صفر/سالب/NaN/لا نهائي) تسقط إلى الحد المفترض", () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveContextLimit({ contextLength: bad })).toEqual({ limit: ASSUMED_CONTEXT_LIMIT, assumed: true });
    }
  });

  it("الحد المفترض رقم واحد معلن", () => {
    expect(ASSUMED_CONTEXT_LIMIT).toBe(128_000);
  });
});
