import { describe, expect, it, vi } from "vitest";
import { memoryFileSink } from "@/lib/markdown/sink";
import { appendTurn } from "@/lib/markdown/writer";
import { recoverSessionsFromDisk, noticeFromRecoveryReport, type ImportPayload, type RecoverSessionsDeps } from "./startupRecovery";

const meta = { id: "st-1", title: "جلسة", createdAt: 1, updatedAt: 2, modelIds: ["m"], primaryTarget: null, layoutMode: "vertical" as const, onDisk: true, onDiskDir: "folder-st" };

const turnData = {
  turn: { id: "turn-1", sharedPrompt: "سؤال", customs: {} },
  prompts: [{ targetId: "t1", providerId: "openrouter" as const, modelId: "gpt-4o", text: "سؤال", hasShared: true, hasCustom: false }],
  results: [{ targetId: "t1", text: "جواب", usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, costUSD: null } }],
  status: { t1: "done" }, errors: {}, createdAt: 5, attemptId: "at-1",
};

function deps(sink: ReturnType<typeof memoryFileSink>, overrides: Partial<RecoverSessionsDeps> = {}): RecoverSessionsDeps {
  return {
    sink,
    rootDir: "sessions",
    filePersistActive: true,
    existingSessionCount: () => 0,
    isTombstoned: async () => false,
    importSession: async () => "imported",
    onImported: async () => undefined,
    ...overrides,
  };
}

describe("recoverSessionsFromDisk", () => {
  it("يستورد الجلسة ذريًا بجدول التمريرات بدل حلقة صفوف مفردة", async () => {
    const sink = memoryFileSink();
    await appendTurn(sink, "sessions/folder-st", meta, turnData);
    const importSession = vi.fn(async (_payload: unknown) => "imported" as const);
    const report = await recoverSessionsFromDisk(deps(sink, { importSession }));
    expect(importSession).toHaveBeenCalledTimes(1);
    const payload = importSession.mock.calls[0]![0] as ImportPayload;
    expect(payload.meta.id).toBe("st-1");
    expect(payload.turns).toHaveLength(1);
    expect(payload.turns[0].attempts[0].id).toBe("at-1");
    expect(payload.messages.length).toBeGreaterThan(0);
    expect(payload.usageEvents).toHaveLength(1);
    expect(report.imported).toHaveLength(1);
  });

  it("لا يستورد في وضع الويب أو عند وجود جلسات محفوظة", async () => {
    const sink = memoryFileSink();
    await appendTurn(sink, "sessions/folder-st", meta, turnData);
    const importSession = vi.fn(async () => "imported" as const);
    const web = await recoverSessionsFromDisk(deps(sink, { importSession, filePersistActive: false }));
    const existing = await recoverSessionsFromDisk(deps(sink, { importSession, existingSessionCount: () => 2 }));
    expect(web.imported).toEqual([]);
    expect(existing.imported).toEqual([]);
    expect(importSession).not.toHaveBeenCalled();
  });

  it("يحوّل نتيجة محجوبة إلى ملاحظة قابلة للعرض ولا يدّعي نجاحًا", async () => {
    const sink = memoryFileSink();
    await appendTurn(sink, "sessions/folder-st", meta, turnData);
    const report = await recoverSessionsFromDisk(deps(sink, {
      importSession: async () => "tombstoned",
    }));
    expect(report.skippedTombstoned).toEqual(["st-1"]);
    const notice = noticeFromRecoveryReport(report);
    expect(notice?.title).toBeTruthy();
    expect(notice?.details.join(" ")).toContain("st-1");
  });

  it("يعرض ملاحظة للحجر والأخطاء ولا يعرض شيئًا عند.reportفارغ", async () => {
    const notice = noticeFromRecoveryReport({
      imported: [],
      quarantined: [{ dir: "quarantine/broken-1", reason: "meta.json تالف" }],
      skippedTombstoned: ["x"],
      errors: ["تعذر قراءة المجلد"],
    });
    expect(notice?.details).toHaveLength(3);
    expect(noticeFromRecoveryReport({ imported: [], quarantined: [], skippedTombstoned: [], errors: [] })).toBeNull();
  });

  it("يسجّل فشل الاستيراد كخطأ بدل ابتلاعه", async () => {
    const sink = memoryFileSink();
    await appendTurn(sink, "sessions/folder-st", meta, turnData);
    const report = await recoverSessionsFromDisk(deps(sink, {
      importSession: async () => { throw new Error("فشل استيرادQuotaExceeded"); },
    }));
    expect(report.imported).toHaveLength(0);
    expect(report.errors).toHaveLength(1);
    expect(noticeFromRecoveryReport(report)).not.toBeNull();
  });

  it("يخبر القارئ بأن الاستيراد اكتمل عبر onImported فقط", async () => {
    const sink = memoryFileSink();
    await appendTurn(sink, "sessions/folder-st", meta, turnData);
    const onImported = vi.fn(async () => undefined);
    await recoverSessionsFromDisk(deps(sink, { onImported }));
    expect(onImported).toHaveBeenCalledTimes(1);
    const empty = memoryFileSink();
    const onImported2 = vi.fn(async () => undefined);
    await recoverSessionsFromDisk(deps(empty, { onImported: onImported2 }));
    expect(onImported2).not.toHaveBeenCalled();
  });
});
