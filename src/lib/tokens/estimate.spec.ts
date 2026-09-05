import { describe, expect, it } from "vitest";
import { contextLevel, contextPercent, estimateSessionTokens, estimateTokens } from "./estimate";
import type { ChatMessage } from "@/types";

const msg = (text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id: extra.id ?? text, sessionId: "s", turnId: "t", createdAt: 1, role: "assistant", kind: "result", text, status: "done", ...extra });

describe("estimate", () => {
  it("تقدير تقريبي chars/4 مع تقريب لأعلى", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("")).toBe(0);
  });
  it("مجموع الجلسة يشمل الرسائل النصية فقط", () => {
    const msgs = [msg("12345678"), msg("x"), msg("")];
    expect(estimateSessionTokens(msgs)).toBe(3);
  });
  it("النسبة والمستويات: 80% أصفر و95% أحمر", () => {
    expect(contextPercent(50, 100)).toBe(50);
    expect(contextLevel(79, 100)).toBe("ok");
    expect(contextLevel(80, 100)).toBe("warn");
    expect(contextLevel(95, 100)).toBe("danger");
  });
});
