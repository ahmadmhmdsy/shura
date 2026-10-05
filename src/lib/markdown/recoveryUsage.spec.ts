import { describe, expect, it } from "vitest";
import { archiveMessageId, buildRecoveredUsageEvent } from "./recoveryUsage";
import type { ArchiveTurn } from "./writer";
import type { SessionMeta, TargetSnapshot, Usage } from "@/types";

const modelInfo = { id: "openai/gpt-4o", label: "GPT-4o" };

function makeTurn(overrides: Partial<ArchiveTurn> = {}): ArchiveTurn {
  return {
    id: "turn-1",
    turnId: "t1",
    attemptId: "a1",
    attempt: 1,
    kind: "send",
    dirName: "turns/t01",
    sharedPrompt: "سؤال",
    prompts: [],
    results: [],
    status: {},
    errors: {},
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

const meta: SessionMeta = {
  id: "s1",
  title: "جلسة",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  modelIds: [],
  primaryTarget: null,
  layoutMode: "vertical",
  onDisk: true,
};

const prompt: TargetSnapshot = {
  targetId: "tgt1",
  providerId: "openrouter",
  modelId: "openai/gpt-4o",
  modelInfo,
  sharedPrompt: "سؤال",
  customPrompt: null,
  promptText: "سؤال",
  hasShared: true,
  hasCustom: false,
};

const usage: Usage = { inputTokens: 100, outputTokens: 50, cachedInputTokens: 10, costUSD: 0.5 };

describe("archiveMessageId", () => {
  it("يبني المعرّف من التمريرة والمحاولة واللاحقة", () => {
    expect(archiveMessageId({ turnId: "t1", attemptId: "a1" }, "u1")).toBe("t1:a1:u1");
  });
});

describe("buildRecoveredUsageEvent", () => {
  it("يعيد null عندما لا يوجد استهلاك", () => {
    const turn = makeTurn({ results: [{ targetId: "tgt1", text: "رد", status: "done", usage: null }] });
    expect(buildRecoveredUsageEvent(turn, meta, turn.results[0], prompt)).toBeNull();
  });

  it("يعيد null عندما لا توجد لقطة هدف", () => {
    const turn = makeTurn({ results: [{ targetId: "tgt1", text: "رد", status: "done", usage }] });
    expect(buildRecoveredUsageEvent(turn, meta, turn.results[0], undefined)).toBeNull();
  });

  it("يبني حدث الاستهلاك بجميع الحقول", () => {
    const turn = makeTurn({ results: [{ targetId: "tgt1", text: "رد", status: "done", usage }], operationId: "op1" });
    const event = buildRecoveredUsageEvent(turn, meta, turn.results[0], prompt);
    expect(event).toEqual({
      id: "t1:a1:tgt1",
      sessionId: "s1",
      turnId: "t1",
      ts: 1_700_000_000_000,
      providerId: "openrouter",
      modelId: "openai/gpt-4o",
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 10,
      cacheWriteInputTokens: 0,
      costUSD: 0.5,
      toolCalls: 0,
      durationMs: 0,
      status: "ok",
      attemptId: "a1",
      operationId: "op1",
    });
  });

  it("status يكون error عندما تكون النتيجة خطأ", () => {
    const turn = makeTurn({ results: [{ targetId: "tgt1", text: "", status: "error", usage }] });
    const event = buildRecoveredUsageEvent(turn, meta, turn.results[0], prompt);
    expect(event?.status).toBe("error");
  });

  it("cacheWriteInputTokens الافتراضي صفر عند غيابه", () => {
    const turn = makeTurn({ results: [{ targetId: "tgt1", text: "رد", status: "done", usage }] });
    const event = buildRecoveredUsageEvent(turn, meta, turn.results[0], prompt);
    expect(event?.cacheWriteInputTokens).toBe(0);
  });
});
