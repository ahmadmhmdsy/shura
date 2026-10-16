/**
 * [T3.2c] عقد الفئة الرابعة: كل خطأ يُنتجه المجال ليراه المستخدم يحمل مفتاح مورد، ويُترجَم عند
 * الحدّ بلغة الواجهة النشطة - لا بلغة لحظة الرمي.
 *
 * الاختبار يثبت لكل منتج: أن الرمي مُفتَّح (`isKeyedError`)، وأن المفتاح هو المتوقَّع، وأن النصّ
 * المعروض يتبع اللغة النشطة. وهذا هو العقد الذي كان ناقصًا حين كان `keyTest.ts` يطابق رسالة
 * `context.ts` العربية بنمط نصّي: تغيير صياغة الرسالة كان يكسر الترجمة صامتًا.
 */
import { afterEach, describe, expect, it } from "vitest";
import { uiText } from "@/i18n";
import { KeyedError, errorText, isKeyedError } from "@/lib/errors/keyedError";
import { buildContextMessages } from "@/lib/chat/context";
import { buildTurnTargets } from "@/lib/chat/turnBuilder";
import { buildLanguageModel, getProvider } from "@/lib/providers/registry";
import { fetchModelCatalog } from "@/lib/providers/modelCatalog";
import { mapProviderError } from "@/lib/providers/keyTest";
import { validateModelSwitch } from "@/lib/rag/reindexManager";
import { deleteSessionDurably, writeDiskTombstone } from "@/lib/sessionDeletion";
import { noticeFromRecoveryReport } from "@/lib/startupRecovery";
import { memoryFileSink } from "@/lib/markdown/sink";
import { LIMITS } from "@/lib/limits";
import { useSettingsStore } from "@/state/settingsStore";
import { useSessionsStore } from "@/state/sessionsStore";
import { en } from "@/i18n/en";
import type { Turn } from "@/types";

const originalLocale = uiText.getLocale();
afterEach(() => uiText.setLocale(originalLocale));

/** يشغّل دالة ترمي، ويعيد الخطأ المُفتَّح الذي أطلقته - ويفشل إن لم يكن مُفتَّحًا. */
function thrown(run: () => unknown): KeyedError {
  try {
    run();
  } catch (error) {
    if (!isKeyedError(error)) throw new Error("خطأ غير مُفتَّح: " + String(error), { cause: error });
    return error;
  }
  throw new Error("لم يُرمَ أي خطأ");
}

/** ينتظر رفضًا ويعيد سببه (يفشل إن نجح النداء). */
async function rejection(promise: Promise<unknown>): Promise<KeyedError> {
  try {
    await promise;
  } catch (error) {
    if (!isKeyedError(error)) throw new Error("رفض غير مُفتَّح: " + String(error), { cause: error });
    return error;
  }
  throw new Error("لم يُرفض النداء");
}

const targets = [{ targetId: "t1", providerId: "openrouter", modelId: "openai/gpt-4o" }] as const;

const turn = (shared: string | null, customs: Record<string, string> = {}): Turn =>
  ({ id: "turn-1", sharedPrompt: shared, customs });

describe("context.ts - حدود السياق", () => {
  it("الحدّ غير الصالح يحمل مفتاحًا لا نصًّا", () => {
    expect(thrown(() => buildContextMessages([], "س", "stateful", 0)).key).toBe("errors.invalidContextLength");
  });

  it("تجاوز السياق يحمل الحدّ كوسيط ويُترجَم بلغة القارئ لا بلغة الرمي", () => {
    const error = thrown(() => buildContextMessages([], "ا".repeat(400), "stateful", 100));
    expect(error.key).toBe("errors.contextOverflow");
    expect(error.args).toEqual({ max: 100 });
    uiText.setLocale("ar");
    expect(errorText(uiText.t, error)).toContain("(100 رمز)");
    uiText.setLocale("en");
    expect(errorText(uiText.t, error)).toContain("(100 tokens)");
  });
});

describe("turnBuilder.ts - حرّاس البناء", () => {
  it("وضع الربط بلا سؤال موحد", () => {
    expect(thrown(() => buildTurnTargets(turn(null), [...targets], true)).key).toBe("errors.syncNeedsSharedPrompt");
  });

  it("وضع الربط بلا أهداف يعيد استخدام مفتاح الواجهة نفسه", () => {
    expect(thrown(() => buildTurnTargets(turn("س"), [], true)).key).toBe("chat.noTargets");
  });

  it("بلا موحد ولا مخصص", () => {
    expect(thrown(() => buildTurnTargets(turn(null), [...targets], false)).key).toBe("errors.noPromptForAnyTarget");
  });
});

describe("registry.ts - حرّاس المزوّد", () => {
  it("مزود غير معروف", () => {
    expect(thrown(() => getProvider("nope" as never)).key).toBe("errors.unknownProvider");
  });

  it("مفتاح ناقص يحمل اسم المزوّد ويُترجَم عند الحدّ", () => {
    const error = thrown(() => buildLanguageModel("minimax", "", "MiniMax-M2", async () => new Response()));
    expect(error.key).toBe("errors.apiKeyMissing");
    uiText.setLocale("ar");
    expect(errorText(uiText.t, error)).toContain("غير مضبوط");
    uiText.setLocale("en");
    expect(errorText(uiText.t, error)).toContain("not set");
  });
});

describe("modelCatalog.ts - أخطاء الجلب", () => {
  it("قائمة تحتاج مفتاحًا ترفض بلا أي شبكة", async () => {
    const error = await rejection(fetchModelCatalog("opencodego", { apiKey: "" }));
    expect(error.key).toBe("errors.catalogNeedsKey");
  });

  it("مزود بلا مصدر مباشر", async () => {
    const error = await rejection(fetchModelCatalog("google", { fetchImpl: async () => new Response("{}") }));
    expect(error.key).toBe("errors.catalogNotLive");
  });

  it("استجابة HTTP فاشلة تحمل الحالة كوسيط", async () => {
    const error = await rejection(fetchModelCatalog("openrouter", { fetchImpl: async () => new Response("nope", { status: 503 }) }));
    expect(error.key).toBe("errors.catalogFetchFailed");
    expect(error.args).toEqual({ status: 503 });
  });

  it("المهلة تحمل عدد المللي ثانية", async () => {
    const error = await rejection(fetchModelCatalog("openrouter", {
      fetchImpl: () => new Promise<Response>(() => undefined),
      timeoutMs: 10,
    }));
    expect(error.key).toBe("errors.catalogTimeout");
    expect(error.args).toEqual({ ms: 10 });
  });
});

describe("keyTest.ts - الترجمة بالهوية لا بالنصّ العربي", () => {
  it("خطأ مجال مُفتَّح يُترجَم بمفتاحه بلا أي مطابقة نصّية", () => {
    uiText.setLocale("ar");
    expect(mapProviderError(new KeyedError("errors.contextOverflow", { max: 7 }))).toContain("(7 رمز)");
    uiText.setLocale("en");
    expect(mapProviderError(new KeyedError("errors.contextOverflow", { max: 7 }))).toContain("(7 tokens)");
  });

  it("مهلة النداء المُفتَّحة تصل نصًّا مترجَمًا لا مفتاحًا", () => {
    uiText.setLocale("ar");
    expect(mapProviderError(new KeyedError("errors.callTimeout"))).toBe("انتهت مهلة النداء");
  });

  it("رسالة المزود الخام تُصنَّف وتُترجَم بلغة الواجهة النشطة", () => {
    uiText.setLocale("ar");
    expect(mapProviderError(new Error("Failed to fetch"))).toContain("كتطبيق سطح مكتب");
    uiText.setLocale("en");
    expect(mapProviderError(new Error("Failed to fetch"))).toContain("desktop");
  });
});

describe("reindexManager.ts - تحذير التحويل", () => {
  it("التحذير يتبع اللغة النشطة", () => {
    uiText.setLocale("ar");
    expect(validateModelSwitch("old", "new").warning).toContain("إعادة فهرسة");
    uiText.setLocale("en");
    expect(validateModelSwitch("old", "new").warning).toContain("re-indexing");
  });
});

describe("sessionDeletion.ts - حذف الجلسة", () => {
  const meta = { id: "del-1", title: "لحذف", createdAt: 1, updatedAt: 2, modelIds: ["m"], primaryTarget: null, layoutMode: "vertical" as const, onDisk: true, onDiskDir: "folder-del" };
  const failingSink = () => {
    const base = memoryFileSink();
    return { ...base, async remove() { throw new Error("EBUSY: locked"); } };
  };

  it("معرّف الشاهد غير الآمن يحمل مفتاحًا", async () => {
    const error = await rejection(writeDiskTombstone(memoryFileSink(), "../escape", "sessions"));
    expect(error.key).toBe("errors.invalidSessionIdTombstone");
  });

  it("الجلسة بلا معرّف تحمل مفتاحًا", async () => {
    const error = await rejection(deleteSessionDurably({ ...meta, id: "" }, null, "sessions"));
    expect(error.key).toBe("errors.invalidSessionIdDeletion");
  });

  it("فشل حذف الأرشيف قيمة نصّية باللغة النشطة وقت الإنشاء لا مفتاح", async () => {
    const deleteData = async () => undefined;
    uiText.setLocale("ar");
    const arabic = await deleteSessionDurably(meta, failingSink(), "sessions", { deleteData });
    expect(typeof arabic.warning).toBe("string");
    expect(arabic.warning).toContain("تعذر حذف ملفات الأرشيف: ");
    expect(arabic.warning).toContain("locked");
    expect(arabic.warning).not.toContain("errors.");
    uiText.setLocale("en");
    const english = await deleteSessionDurably(meta, failingSink(), "sessions", { deleteData });
    expect(english.warning).toContain("Could not delete the archive files: ");
  });
});

describe("startupRecovery.ts - ملاحظة الاسترجاع", () => {
  const report = () => ({
    imported: [], quarantined: [{ dir: "quarantine/a", reason: "bad json" }], skippedTombstoned: ["s9"], errors: [],
  });

  it("العنوان والتفاصيل يتبعان اللغة النشطة وقت الإنشاء", () => {
    uiText.setLocale("ar");
    const arabic = noticeFromRecoveryReport(report())!;
    expect(arabic.title).toBe("تقرير استرجاع الأرشيف");
    expect(arabic.details).toEqual(["عُزل أرشيف تالف: quarantine/a (bad json)", "تم تجاوز جلسة محذوفة: s9"]);
    uiText.setLocale("en");
    const english = noticeFromRecoveryReport(report())!;
    expect(english.title).toBe("Archive recovery report");
    expect(english.details).toEqual(["Quarantined a corrupt archive: quarantine/a (bad json)", "Skipped a deleted session: s9"]);
  });
});

describe("settingsStore.ts - مفاتيح المزوّدين", () => {
  it("المزوّد المجهول والمفتاح الطويل يُرميان مفتاحين لا نصًّا", async () => {
    const unknown = await rejection(useSettingsStore.getState().setProviderKey("evil" as never, "x"));
    expect(unknown.key).toBe("errors.unknownProvider");
    const tooLong = await rejection(useSettingsStore.getState().setProviderKey("openrouter", "x".repeat(LIMITS.apiKeyMax + 1)));
    expect(tooLong.key).toBe("errors.apiKeyTooLong");
    uiText.setLocale("en");
    expect(errorText(uiText.t, tooLong)).toBe(en.errors.apiKeyTooLong);
  });
});

describe("sessionsStore.ts - حذف جلسة مفقودة", () => {
  it("الخطأ مُفتَّح بمفتاح مورد", async () => {
    const error = await rejection(useSessionsStore.getState().remove("no-such-session"));
    expect(error.key).toBe("errors.sessionNotFound");
  });
});
