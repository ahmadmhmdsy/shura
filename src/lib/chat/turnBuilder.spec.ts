import { describe, expect, it } from "vitest";
import { buildTurnTargets } from "./turnBuilder";
import type { Turn } from "@/types";

const targets = [
  { targetId: "t1", providerId: "openrouter", modelId: "openai/gpt-4o" },
  { targetId: "t2", providerId: "google", modelId: "gemini-2.5-pro" },
  { targetId: "t3", providerId: "minimax", modelId: "MiniMax-M2" },
] as const;

const turn = (shared: string | null, customs: Record<string, string>): Turn => ({ id: "turn-1", sharedPrompt: shared, customs });

describe("قاعدة التوريث الثلاثية", () => {
  it("مطلق التبديل: الجميع يأخذ الموحد حرفيًا ويُتجاهل المخصص", () => {
    const out = buildTurnTargets(turn("سؤال موحد", { "t1": "خاص مُهمل" }), [...targets], true);
    expect(out.dropped).toEqual([]);
    expect(out.prompts.map((p) => p.text)).toEqual(["سؤال موحد", "سؤال موحد", "سؤال موحد"]);
    expect(out.prompts.every((p) => p.hasShared && !p.hasCustom)).toBe(true);
  });
  it("موحد + مخصص: المخصص يُلحق بعد الموحد بفاصل", () => {
    const out = buildTurnTargets(turn("السؤال العام", { t2: "تعليمات خاصة لجيميناي" }), [...targets], false);
    const t2 = out.prompts.find((p) => p.targetId === "t2")!;
    expect(t2.text).toBe("السؤال العام\n\n[تعليمات خاصة لهذا النموذج]\nتعليمات خاصة لجيميناي");
    expect(t2.hasShared && t2.hasCustom).toBe(true);
  });
  it("موحد بدون مخصص: الموحد فقط", () => {
    const out = buildTurnTargets(turn("السؤال العام", {}), [...targets], false);
    expect(out.prompts.map((p) => p.text)).toEqual(["السؤال العام", "السؤال العام", "السؤال العام"]);
  });
  it("بدون موحد: المخصص فقط لمن كتب، والمقصود يُدرج في dropped", () => {
    const out = buildTurnTargets(turn(null, { t2: "سؤال خاص فقط" }), [...targets], false);
    expect(out.prompts.map((p) => p.targetId)).toEqual(["t2"]);
    expect(out.dropped).toEqual(["t1", "t3"]);
  });
  it("كلاهما فارغ تمامًا يرمي خطأ عربيًا", () => {
    expect(() => buildTurnTargets(turn(null, {}), [...targets], false)).toThrow(/اكتب سؤال/);
  });
  it("الفراغات فقط تُعد فارغة (trim)", () => {
    const out = buildTurnTargets(turn("   ", { t2: "  س  " }), [...targets], false);
    expect(out.prompts.map((p) => p.text)).toEqual(["س"]);
  });
});
