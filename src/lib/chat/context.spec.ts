import { describe, expect, it } from "vitest";
import { buildContextMessages } from "./context";
import type { ChatMessage } from "@/types";

const msg = (over: Partial<ChatMessage> & Pick<ChatMessage, "id" | "turnId" | "role" | "text" | "createdAt">): ChatMessage => ({
  sessionId: "s1",
  kind: over.role === "user" ? "prompt" : "result",
  status: "done",
  ...over,
});

const currentOf = (n: number, ch = "x") => ch.repeat(n);

describe("buildContextMessages", () => {
  it("وضع عديم الحالة: يعيد سؤال المستخدم الحالي فقط ويتجاهل السجل", () => {
    const history = [
      msg({ id: "m1", turnId: "t1", role: "user", text: "سؤال قديم", createdAt: 10 }),
      msg({ id: "m2", turnId: "t1", role: "assistant", text: "جواب قديم", createdAt: 20 }),
    ];
    const out = buildContextMessages(history, currentOf(40), "stateless", 10_000);
    expect(out).toEqual([{ role: "user", content: currentOf(40) }]);
  });

  it("سياق غير صالح (صفر/سالب/غير رقم) يرمي خطأ عربيًا", () => {
    for (const bad of [0, -5, Number.NaN, Infinity]) {
      expect(() => buildContextMessages([], "س", "stateful", bad)).toThrow(/حد السياق غير صالح/);
    }
  });

  it("سؤال المستخدم الحالي وحده يتجاوز 80% من الحد يرمي خطأ عربيًا", () => {
    // 400 حرف ÷ 4 = 100 تقديرًا > 1000 × 0.8 = 800؟ لا: 100 < 800 — نستخدم حدًا صغيرًا
    expect(() => buildContextMessages([], currentOf(400), "stateful", 100)).toThrow(/السؤال الحالي يتجاوز حد السياق الآمن/);
    expect(() => buildContextMessages([], currentOf(3600), "stateless", 1000)).toThrow(/السؤال الحالي يتجاوز حد السياق الآمن/);
  });

  it("حالة بالسجل: يحافظ على الأدوار المكتملة غير المستبدلة غير الفارغة بالترتيب الزمني ثم السؤال الحالي", () => {
    const history = [
      msg({ id: "m1", turnId: "t1", role: "user", text: "س1", createdAt: 10 }),
      msg({ id: "m2", turnId: "t1", role: "assistant", text: "ج1", createdAt: 20 }),
      msg({ id: "m3", turnId: "t2", role: "user", text: "س2", createdAt: 30 }),
      msg({ id: "m4", turnId: "t2", role: "assistant", text: "ج2", createdAt: 40 }),
    ];
    const out = buildContextMessages(history, "السؤال الحالي", "stateful", 10_000);
    expect(out).toEqual([
      { role: "user", content: "س1" },
      { role: "assistant", content: "ج1" },
      { role: "user", content: "س2" },
      { role: "assistant", content: "ج2" },
      { role: "user", content: "السؤال الحالي" },
    ]);
  });

  it("يستبعد صفوف البث والخطأ والتوقف والفارغة والمستبدلة", () => {
    const history = [
      msg({ id: "m1", turnId: "t1", role: "user", text: "س1", createdAt: 10 }),
      msg({ id: "m2", turnId: "t1", role: "assistant", text: "ج1", createdAt: 20 }),
      msg({ id: "m3", turnId: "t2", role: "user", text: "بث", createdAt: 30, status: "streaming" }),
      msg({ id: "m4", turnId: "t2", role: "assistant", text: "خطأ", createdAt: 40, status: "error" }),
      msg({ id: "m5", turnId: "t2", role: "assistant", text: "موقوف", createdAt: 50, status: "stopped" }),
      msg({ id: "m6", turnId: "t3", role: "user", text: "مستبدل", createdAt: 60, superseded: true }),
      msg({ id: "m7", turnId: "t3", role: "assistant", text: "رد مستبدل", createdAt: 70, superseded: true }),
      msg({ id: "m8", turnId: "t4", role: "user", text: "   ", createdAt: 80 }),
      msg({ id: "m9", turnId: "t4", role: "assistant", text: "بلا سؤال فعلي", createdAt: 90 }),
    ];
    const out = buildContextMessages(history, "الآن", "stateful", 10_000);
    expect(out).toEqual([
      { role: "user", content: "س1" },
      { role: "assistant", content: "ج1" },
      { role: "user", content: "الآن" },
    ]);
  });

  it("الدور الناقص (سؤال بلا رد أو رد بلا سؤال) يُستبعد لأن الدورة غير مكتملة", () => {
    const history = [
      msg({ id: "m1", turnId: "t1", role: "user", text: "سؤال معلق", createdAt: 10 }),
      msg({ id: "m2", turnId: "t2", role: "assistant", text: "رد يتيم", createdAt: 20 }),
      msg({ id: "m3", turnId: "t3", role: "user", text: "س3", createdAt: 30 }),
      msg({ id: "m4", turnId: "t3", role: "assistant", text: "ج3", createdAt: 40 }),
    ];
    const out = buildContextMessages(history, "الآن", "stateful", 10_000);
    expect(out).toEqual([
      { role: "user", content: "س3" },
      { role: "assistant", content: "ج3" },
      { role: "user", content: "الآن" },
    ]);
  });

  it("الترتيب مستقر حسب أقدم createdAt لكل دورة حتى لو ورد الرد قبل السؤال في المصفوفة", () => {
    const history = [
      msg({ id: "m3", turnId: "t2", role: "assistant", text: "ج2", createdAt: 40 }),
      msg({ id: "m1", turnId: "t1", role: "assistant", text: "ج1", createdAt: 20 }),
      msg({ id: "m4", turnId: "t2", role: "user", text: "س2", createdAt: 30 }),
      msg({ id: "m2", turnId: "t1", role: "user", text: "س1", createdAt: 10 }),
    ];
    const out = buildContextMessages(history, "الآن", "stateful", 10_000);
    expect(out.map((m) => m.content)).toEqual(["س1", "ج1", "س2", "ج2", "الآن"]);
  });

  it("التقليم: يُسقط أقدم دورة مكتملة حتى يصبح التقدير ≤ 80% من الحد دون إسقاط السؤال الحالي", () => {
    const history = [
      // دورة t1: 2000 + 1600 حرف = 900 تقدير
      msg({ id: "m1", turnId: "t1", role: "user", text: "a".repeat(2000), createdAt: 10 }),
      msg({ id: "m2", turnId: "t1", role: "assistant", text: "b".repeat(1600), createdAt: 20 }),
      // دورة t2: 400 + 400 حرف = 200 تقدير
      msg({ id: "m3", turnId: "t2", role: "user", text: "c".repeat(400), createdAt: 30 }),
      msg({ id: "m4", turnId: "t2", role: "assistant", text: "d".repeat(400), createdAt: 40 }),
    ];
    // الحد 1000 → الميزانية 800؛ الكل + الحالي (100) = 1200 > 800 → تُسقط t1 → 300 ≤ 800
    const out = buildContextMessages(history, currentOf(400), "stateful", 1000);
    expect(out.map((m) => m.content)).toEqual(["c".repeat(400), "d".repeat(400), currentOf(400)]);
  });

  it("التقليم بالتساوي: التقدير عند 80% بالضبط مسموح (≤) وتُبقى الدورة", () => {
    const history = [
      // دورة t1: 2000 + 800 = 700 تقدير
      msg({ id: "m1", turnId: "t1", role: "user", text: "a".repeat(2000), createdAt: 10 }),
      msg({ id: "m2", turnId: "t1", role: "assistant", text: "b".repeat(800), createdAt: 20 }),
      // دورة t2: 2000 + 800 = 700 تقدير
      msg({ id: "m3", turnId: "t2", role: "user", text: "c".repeat(2000), createdAt: 30 }),
      msg({ id: "m4", turnId: "t2", role: "assistant", text: "d".repeat(800), createdAt: 40 }),
    ];
    // الحد 1000 → ميزانية 800: الكل 700+700+100(الحالي) = 1500 > 800 → إسقاط t1 → 700+100 = 800 ≤ 800
    const out = buildContextMessages(history, currentOf(400), "stateful", 1000);
    expect(out.map((m) => m.content)).toEqual(["c".repeat(2000), "d".repeat(800), currentOf(400)]);
  });

  it("حتى بعد إسقاط كل الدورات يبقى السؤال الحالي دائمًا أخيرًا", () => {
    const history = [
      msg({ id: "m1", turnId: "t1", role: "user", text: "a".repeat(3200), createdAt: 10 }),
      msg({ id: "m2", turnId: "t1", role: "assistant", text: "b".repeat(3200), createdAt: 20 }),
    ];
    // الحد 1000 → ميزانية 800: الدورة 1600 > 800، والحالي وحده 800 ≤ 800
    const out = buildContextMessages(history, currentOf(3200), "stateful", 1000);
    expect(out).toEqual([{ role: "user", content: currentOf(3200) }]);
  });
});
