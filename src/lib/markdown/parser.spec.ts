import { describe, expect, it } from "vitest";
import { memoryFileSink } from "./sink";
import { appendTurn } from "./writer";
import { importSessionFromDisk, recoverFromDisk } from "./parser";

const meta = { id: "ab12cd34", title: "عنوان", createdAt: 1, updatedAt: 2, modelIds: ["m"], primaryTarget: null, layoutMode: "vertical" as const, onDisk: true };
const turnData = {
  turn: { id: "t1", sharedPrompt: "س؟", customs: { t2: "خاص" } },
  prompts: [
    { targetId: "t1", providerId: "openrouter" as const, modelId: "gpt-4o", text: "س؟", hasShared: true, hasCustom: false },
    { targetId: "t2", providerId: "google" as const, modelId: "gemini", text: "س؟\nخاص", hasShared: true, hasCustom: true },
  ],
  results: [
    { targetId: "t1", text: "جواب 1", usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0, costUSD: 0.001 } },
    { targetId: "t2", text: "جواب 2", usage: { inputTokens: 8, outputTokens: 3, cachedInputTokens: 0, costUSD: null } },
  ],
  status: { t1: "done", t2: "done" },
  errors: {},
  createdAt: 1000,
};

describe("parser: استرجاع الجلسة من القرص", () => {
  it("يعيد بناء الجلسة والرسائل والأحداث من meta.json", async () => {
    const sink = memoryFileSink();
    const dir = "sessions/abc";
    await appendTurn(sink, dir, meta, turnData);
    const restored = await importSessionFromDisk(sink, dir);
    expect(restored.meta.id).toBe("ab12cd34");
    expect(restored.messages.filter((m) => m.role === "user")).toHaveLength(2);
    expect(restored.messages.filter((m) => m.role === "assistant")).toHaveLength(2);
    expect(restored.usageEvents).toHaveLength(2);
    expect(restored.usageEvents[0].inputTokens).toBe(10);
  });
  it("recoverFromDisk يستورد كل المجلدات ذات meta.json ويتجاهل غيرها", async () => {
    const sink = memoryFileSink();
    await appendTurn(sink, "sessions/one", meta, turnData);
    await appendTurn(sink, "sessions/two", { ...meta, id: "ff00ee11" }, turnData);
    await sink.writeFile("sessions/empty/readme.txt", "hi");
    const report = await recoverFromDisk(sink, "sessions");
    expect(report.imported.map((g) => g.meta.id).sort()).toEqual(["ab12cd34", "ff00ee11"]);
  });
  it("recoverFromDisk يستورد الجلسات الصالحة ويعرض ملاحظات بدل ابتلاعها", async () => {
    const sink = memoryFileSink();
    await appendTurn(sink, "sessions/one", meta, turnData);
    const report = await recoverFromDisk(sink, "sessions");
    expect(report.errors).toEqual([]);
    expect(report.quarantined).toEqual([]);
    expect(report.skippedTombstoned).toEqual([]);
  });
  it("recoverFromDisk يعيد بناء رسالة الخلاصة بنصها من تمريرة syn-", async () => {
    const sink = memoryFileSink();
    const dir = "sessions/s1";
    await appendTurn(sink, dir, meta, {
      turn: { id: "syn-t1", sharedPrompt: "نص الخلاصة الفعلي", customs: {} },
      prompts: [],
      results: [{ targetId: "m9", text: "نص الخلاصة الفعلي", usage: { inputTokens: 3, outputTokens: 2, cachedInputTokens: 0, costUSD: null } }],
      status: { m9: "done" },
      errors: {},
      createdAt: 2000,
    });
    const restored = await importSessionFromDisk(sink, dir);
    const synth = restored.messages.find((m) => m.kind === "synthesis");
    expect(synth?.text).toBe("نص الخلاصة الفعلي");
    expect(synth?.status).toBe("done");
    expect(synth?.usage?.inputTokens).toBe(3);
    expect(restored.messages.filter((m) => m.role === "user")).toHaveLength(0);
  });
});
