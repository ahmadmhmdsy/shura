import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db";
import {
  appendMessage,
  claimOperationLease,
  createSession,
  deleteSession,
  deleteSessionData,
  getMessages,
  getOperationLease,
  getSession,
  getSetting,
  getTurn,
  getTurns,
  persistTurnAttempt,
  supersedeTurnAttempts,
  updateTurnAttemptStatus,
  hasTombstone,
  importSessionAtomically,
  INTERRUPTED_TURN_ERROR,
  listSessions,
  putTurn,
  releaseOperationLease,
  reconcileInterruptedTurns,
  recordUsage,
  selectPersistedRetryAttempt,
  setSetting,
  updateSession,
  updateSessionIfOperation,
} from "./repos";
import type { ChatMessage, SessionMeta, TargetSnapshot, TurnAttempt, UsageEvent } from "@/types";
import { chatMessage, meta, turnRecord, usageEvent as mkUsage } from "@/test/helpers";
import { liveOperationKey } from "@/lib/operationIdentity";

const session = (id: string): SessionMeta => ({ id, title: "جلسة " + id, createdAt: 1, updatedAt: 1, modelIds: [], primaryTarget: null, layoutMode: "vertical", onDisk: false, contextMode: "stateful", targets: [] });

const snapshotFor = (id: string, customPrompt = "محفوظ"): TargetSnapshot => ({
  targetId: id,
  providerId: "openrouter",
  modelId: "model-1",
  modelInfo: { id: "model-1", label: "Model 1" },
  sharedPrompt: "سؤال",
  customPrompt,
  promptText: customPrompt ?? "سؤال",
  hasShared: true,
  hasCustom: customPrompt !== null,
});

const attemptFor = (id: string, attempt: number, operationId: string, targets: TargetSnapshot[] = [snapshotFor("t1")]): TurnAttempt => ({
  id,
  turnId: "turn-retry",
  attempt,
  kind: "retry",
  createdAt: 10,
  status: "streaming",
  operationId,
  targets,
});

beforeEach(async () => {
  await db.sessions.clear();
  await db.messages.clear();
  await db.usage_events.clear();
  await db.turns.clear();
  await db.tombstones.clear();
  await db.settings.clear();
  await db.operation_leases.clear();
});

describe("repos", () => {
  it("لا يحدّث بيانات الجلسة من عملية قديمة بعد حجز عملية بديلة", async () => {
    await createSession(session("guarded-session"));
    await claimOperationLease("guarded-session", "op-old", "turn-old", () => true);
    expect(await updateSessionIfOperation("guarded-session", "op-old", { title: "old" })).toBe(true);
    await claimOperationLease("guarded-session", "op-new", "turn-new", () => true);
    expect(await updateSessionIfOperation("guarded-session", "op-old", { title: "stale" })).toBe(false);
    expect((await getSession("guarded-session"))?.title).toBe("old");
    expect(await updateSessionIfOperation("guarded-session", "op-new", { title: "new" })).toBe(true);
  });

  it("يرفض تحديث بيانات الجلسة عندما يتغير ownership قبل/أثناء المعاملة", async () => {
    await createSession(session("guarded-callback"));
    await claimOperationLease("guarded-callback", "op-old", "turn-old", () => true);
    let allowed = false;
    expect(await updateSessionIfOperation("guarded-callback", "op-old", { title: "stale" }, () => allowed)).toBe(false);
    expect((await getSession("guarded-callback"))?.title).toBe("جلسة guarded-callback");
    allowed = true;
    expect(await updateSessionIfOperation("guarded-callback", "op-old", { title: "live" }, () => allowed)).toBe(true);
  });

  it("إنشاء جلسة وسرد الجلسات بترتيب التحديث", async () => {
    await createSession(session("a"));
    await createSession({ ...session("b"), updatedAt: 5 });
    const list = await listSessions();
    expect(list.map((s) => s.id)).toEqual(["b", "a"]);
  });
  it("تطبيق تحديث على جلسة", async () => {
    await createSession(session("a"));
    await updateSession("a", { title: "معدلة", onDisk: true });
    const s = (await listSessions())[0];
    expect(s.title).toBe("معدلة");
    expect(s.onDisk).toBe(true);
  });
  it("إلحاق رسائل وجلبها بترتيب الإنشاء", async () => {
    await createSession(session("a"));
    const m1 = chatMessage("m1", "a", { createdAt: 10, text: "س1", operationId: undefined, attemptId: undefined, attempt: undefined });
    const m2 = chatMessage("m2", "a", { createdAt: 20, text: "س2", operationId: undefined, attemptId: undefined, attempt: undefined });
    await appendMessage(m1); await appendMessage(m2);
    const got = await getMessages("a");
    expect(got.map((m) => m.text)).toEqual(["س1", "س2"]);
  });
  it("حذف جلسة يمسح رسائلها واستهلاكها", async () => {
    await createSession(session("a"));
    await recordUsage(mkUsage("u1", "a"));
    await appendMessage(chatMessage("m1", "a"));
    await deleteSession("a");
    expect(await getMessages("a")).toEqual([]);
    expect(await db.usage_events.where("sessionId").equals("a").count()).toBe(0);
  });
  it("الإعدادات: تدوير قيمة", async () => {
    await setSetting("theme", "dark");
    expect(await getSetting<string>("theme")).toBe("dark");
    await setSetting("theme", "light");
    expect(await getSetting<string>("theme")).toBe("light");
  });
});

describe("turns and tombstones (schema v2)", () => {
  it("deleteSessionData removes every row and writes a tombstone atomically", async () => {
    await createSession(meta("t1"));
    await appendMessage(chatMessage("m1", "t1"));
    await recordUsage(mkUsage("u1", "t1"));
    await putTurn(turnRecord("tr1", "t1"));
    await deleteSessionData("t1");
    expect(await db.sessions.get("t1")).toBeUndefined();
    expect(await db.messages.where("sessionId").equals("t1").count()).toBe(0);
    expect(await db.usage_events.where("sessionId").equals("t1").count()).toBe(0);
    expect(await db.turns.where("sessionId").equals("t1").count()).toBe(0);
    expect(await hasTombstone("t1")).toBe(true);
    // Idempotent: deleting again keeps exactly one tombstone.
    await deleteSessionData("t1");
    expect(await db.tombstones.count()).toBe(1);
  });

  it("الكتابة المتأخرة بعد حذف الجلسة ترفض ولا تُعيد إنشاء الصفوف", async () => {
    await createSession(session("late-write"));
    await appendMessage(chatMessage("m1", "late-write"));
    await deleteSessionData("late-write");
    expect(await hasTombstone("late-write")).toBe(true);
    // A late primary/terminal row must never resurrect a deleted session.
    const late = await appendMessage(chatMessage("m-late", "late-write", { status: "error" }));
    expect(late.accepted).toBe(false);
    expect(await getMessages("late-write")).toEqual([]);
    // A late usage sidecar must not recreate rows either.
    await recordUsage(mkUsage("u-late", "late-write")).catch(() => undefined);
    expect(await db.usage_events.where("sessionId").equals("late-write").count()).toBe(0);
    expect(await getTurns("late-write")).toEqual([]);
  });

  it("حذف الجلسة يترك شاهد حذف فلا تُعاد كتابتها", async () => {
    await createSession(session("legacy-delete"));
    await appendMessage(chatMessage("m1", "legacy-delete"));
    await deleteSession("legacy-delete");
    // Legacy deleteSession must use the same tombstone-aware primitive so a late
    // write can never recreate the session it just removed.
    expect(await hasTombstone("legacy-delete")).toBe(true);
    const late = await appendMessage(chatMessage("m-late", "legacy-delete"));
    expect(late.accepted).toBe(false);
    expect(await getMessages("legacy-delete")).toEqual([]);
  });

  it("يحذف سجل lease مع بيانات الجلسة ولا يتركه قابلًا لإعادة الاستخدام", async () => {
    await createSession(session("lease-delete"));
    await claimOperationLease("lease-delete", "op-delete", "turn-delete", () => true);
    await deleteSession("lease-delete");
    expect(await getOperationLease("lease-delete")).toBeUndefined();
    await claimOperationLease("lease-delete", "op-delete-2", "turn-delete", () => true);
    await deleteSessionData("lease-delete");
    expect(await getOperationLease("lease-delete")).toBeUndefined();
  });

  it("importSessionAtomically writes the whole payload or rejects on tombstone", async () => {
    const m: ChatMessage[] = [chatMessage("m1", "t2")];
    const u: UsageEvent[] = [mkUsage("u1", "t2")];
    expect(await importSessionAtomically(meta("t2"), m, [turnRecord("tr1", "t2")], u)).toBe("imported");
    expect(await db.sessions.get("t2")).toBeTruthy();
    expect(await getTurn("tr1")).toBeTruthy();
    expect((await getTurns("t2")).map((t) => t.id)).toEqual(["tr1"]);
    expect(await getMessages("t2")).toHaveLength(1);
    // Tombstoned sessions cannot be imported again; nothing is written.
    await deleteSessionData("t3");
    const before = await db.sessions.count();
    expect(await importSessionAtomically(meta("t3"), m, [], u)).toBe("tombstoned");
    expect(await db.sessions.count()).toBe(before);
  });

  it("putTurn/getTurn/getTurns round-trip turns by session", async () => {
    await putTurn(turnRecord("tr1", "t4", { createdAt: 2 }));
    await putTurn(turnRecord("tr2", "t4", { createdAt: 1 }));
    await putTurn(turnRecord("tr3", "t5"));
    expect((await getTurns("t4")).map((t) => t.id)).toEqual(["tr2", "tr1"]);
    expect((await getTurn("tr1"))?.sessionId).toBe("t4");
    expect(await getTurn("missing")).toBeUndefined();
  });

  it("putTurn rejects a global turn-id collision and preserves the owner", async () => {
    await putTurn(turnRecord("shared-turn", "owner-session"));
    await expect(putTurn(turnRecord("shared-turn", "other-session"))).rejects.toThrow(/collision/i);
    expect(await getTurn("shared-turn")).toMatchObject({ id: "shared-turn", sessionId: "owner-session" });
  });

  it("importSessionAtomically rolls back a foreign turn-id collision", async () => {
    await putTurn(turnRecord("shared-turn", "owner-session"));
    await expect(importSessionAtomically(
      meta("imported-session"),
      [chatMessage("imported-message", "imported-session")],
      [turnRecord("shared-turn", "imported-session")],
      [mkUsage("imported-usage", "imported-session")],
    )).rejects.toThrow(/collision/i);

    expect(await getTurn("shared-turn")).toMatchObject({ sessionId: "owner-session" });
    expect(await db.sessions.get("imported-session")).toBeUndefined();
    expect(await db.messages.where("sessionId").equals("imported-session").count()).toBe(0);
    expect(await db.usage_events.where("sessionId").equals("imported-session").count()).toBe(0);
  });

  it("يرفض صفًا identified متأخرًا يغيّر حالة المحاولة terminal إلى حالة terminal أخرى", async () => {
    const sessionId = "s-terminal-transition";
    const turnId = "turn-terminal-transition";
    const attempt = { ...attemptFor("at-terminal-transition", 1, "op-terminal-transition"), turnId, status: "stopped" as const };
    await putTurn(turnRecord(turnId, sessionId, { status: "stopped", attempts: [attempt] }));
    const late = chatMessage("late-terminal-transition", sessionId, {
      turnId, role: "assistant", kind: "result", targetId: "t1",
      providerId: "openrouter" as const, modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" }, text: "بعد الإيقاف", status: "done",
      operationId: attempt.operationId!, attemptId: attempt.id, attempt: attempt.attempt,
    });

    expect((await appendMessage(late)).accepted).toBe(false);
    expect(await db.messages.get(late.id)).toBeUndefined();
  });

  it("يرفض صفًا identified متأخر streaming بعد أصبحت المحاولة الحالية terminal", async () => {
    const sessionId = "s-terminal-placeholder";
    const turnId = "turn-terminal-placeholder";
    const attempt = { ...attemptFor("at-terminal-placeholder", 1, "op-terminal-placeholder"), turnId, status: "done" as const };
    await putTurn(turnRecord(turnId, sessionId, { status: "done", attempts: [attempt] }));
    const late = chatMessage("late-terminal-placeholder", sessionId, {
      turnId, role: "assistant", kind: "result", targetId: "t1",
      providerId: "openrouter" as const, modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" }, text: "متأخر", status: "streaming",
      operationId: attempt.operationId!, attemptId: attempt.id, attempt: attempt.attempt,
    });

    expect((await appendMessage(late)).accepted).toBe(false);
    expect(await db.messages.get(late.id)).toBeUndefined();
  });

  it("يرفض رسالة identified يتيمة عندما لا يوجد TurnRecord", async () => {
    const orphan = chatMessage("identified-orphan", "s-identified-orphan", {
      turnId: "turn-missing",
      role: "assistant",
      kind: "result",
      providerId: "openrouter" as const,
      modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" },
      status: "streaming",
      operationId: "op-orphan",
      attemptId: "at-orphan",
      attempt: 1,
    });
    const result = await appendMessage(orphan);
    expect(result).toMatchObject({ accepted: false, reason: "stale" });
    expect(await db.messages.get(orphan.id)).toBeUndefined();
  });

  it("يوقف رسالة streaming يتيمة عن turnId ويحتفظ بنصها", async () => {
    const orphan = chatMessage("orphan-1", "s-orphan", {
      turnId: "turn-without-record",
      text: "نص جزئي محفوظ",
      status: "streaming",
      operationId: undefined,
      attemptId: undefined,
      attempt: undefined,
    });
    await appendMessage(orphan);

    expect(await reconcileInterruptedTurns()).toBe(1);
    const saved = await db.messages.get("orphan-1");
    expect(saved).toMatchObject({
      text: "نص جزئي محفوظ",
      status: "stopped",
      error: INTERRUPTED_TURN_ERROR,
    });
  });

  it("يحفظ التوقف فقط للصفوف التي لا تملك عملية حية", async () => {
    await putTurn(turnRecord("turn-live", "s-live", {
      status: "streaming",
      attempts: [{ ...attemptFor("at-live", 1, "op-live", [snapshotFor("t-live")]), turnId: "turn-live" }],
    }));
    await appendMessage(chatMessage("msg-live", "s-live", {
      turnId: "turn-live",
      role: "assistant",
      kind: "result",
      targetId: "t-live",
      providerId: "openrouter" as const,
      modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" },
      text: "نص ما زال حيًا",
      status: "streaming",
      operationId: "op-live",
      attemptId: "at-live",
      attempt: 1,
    }));
    await appendMessage(chatMessage("msg-orphan", "s-live", {
      turnId: "turn-missing",
      role: "assistant",
      kind: "result",
      text: "نص يتيم",
      status: "streaming",
      operationId: undefined,
      attemptId: undefined,
      attempt: undefined,
    }));

    expect(await reconcileInterruptedTurns(new Set([liveOperationKey("s-live", "op-live")]))).toBe(1);
    expect(await db.messages.get("msg-live")).toMatchObject({ text: "نص ما زال حيًا", status: "streaming" });
    expect(await db.messages.get("msg-orphan")).toMatchObject({ text: "نص يتيم", status: "stopped", error: INTERRUPTED_TURN_ERROR });
    expect((await getTurn("turn-live"))?.status).toBe("streaming");

    expect(await reconcileInterruptedTurns()).toBe(1);
    expect(await db.messages.get("msg-live")).toMatchObject({ text: "نص ما زال حيًا", status: "stopped", error: INTERRUPTED_TURN_ERROR });
  });

  it("يبقي TurnRecord حيًا إذا كانidentified live message لاattempt", async () => {
    await putTurn(turnRecord("turn-identified", "s-identified", { status: "streaming", attempts: [] }));
    // Simulate a legacy row already present before the v2 admission guard was added.
    await db.messages.put(chatMessage("msg-identified", "s-identified", {
      turnId: "turn-identified",
      role: "assistant",
      kind: "result",
      text: "نص حي",
      status: "streaming",
      operationId: "op-live-message",
      attemptId: "at-live-message",
      attempt: 1,
    }));
    expect(await reconcileInterruptedTurns(new Set([liveOperationKey("s-identified", "op-live-message")]))).toBe(0);
    expect((await getTurn("turn-identified"))?.status).toBe("streaming");
    expect((await db.messages.get("msg-identified"))?.status).toBe("streaming");
  });

  it("يربط lease بالتمريرة ويمنع إعادة فتحه بعد الانتهاء", async () => {
    const generation = await claimOperationLease("s-bound", "op-bound", "turn-a", () => true);
    expect(generation).toBe(1);
    await expect(claimOperationLease("s-bound", "op-bound", "turn-b", () => true)).rejects.toThrow();
    const leaseForOtherTurn = await claimOperationLease("s-lease-turn", "op-lease-turn", "turn-b", () => true);
    const mismatched = { ...attemptFor("at-bound", 1, "op-lease-turn"), turnId: "turn-a" };
    await expect(persistTurnAttempt("s-lease-turn", "turn-a", mismatched, "stateful", "سؤال", () => true, leaseForOtherTurn)).rejects.toThrow();
    expect(await getTurn("turn-a")).toBeUndefined();
    expect(await releaseOperationLease("s-bound", "op-bound", "finished")).toBe(true);
    expect(await releaseOperationLease("s-bound", "op-bound", "cancelled")).toBe(false);
    expect((await getOperationLease("s-bound"))?.status).toBe("finished");
    await expect(claimOperationLease("s-bound", "op-bound", "turn-a", () => true)).rejects.toThrow();
    const cancelledGeneration = await claimOperationLease("s-cancelled", "op-cancelled", "turn-c", () => true);
    expect(cancelledGeneration).toBe(1);
    await releaseOperationLease("s-cancelled", "op-cancelled", "cancelled");
    expect(await releaseOperationLease("s-cancelled", "op-cancelled", "finished")).toBe(false);
    await expect(claimOperationLease("s-cancelled", "op-cancelled", "turn-c", () => true)).rejects.toThrow();
  });

  it("يرفض حفظ محاولة العملية القديمة بعد أن يحجز بديلها المولد الدائم", async () => {
    const generationA = await claimOperationLease("s-lease", "op-a", "turn-retry", () => true);
    const generationB = await claimOperationLease("s-lease", "op-b", "turn-retry", () => true);
    expect(generationB).toBe(generationA + 1);
    const oldAttempt = attemptFor("at-lease-a", 0, "op-a");
    await expect(persistTurnAttempt("s-lease", "turn-retry", oldAttempt, "stateful", "سؤال", () => false, generationA)).rejects.toThrow();
    const replacement = attemptFor("at-lease-b", 0, "op-b");
    const saved = await persistTurnAttempt("s-lease", "turn-retry", replacement, "stateful", "سؤال", () => true, generationB);
    expect(saved.operationId).toBe("op-b");
    expect((await getTurn("turn-retry"))?.attempts.map((attempt) => attempt.id)).toEqual(["at-lease-b"]);
    await releaseOperationLease("s-lease", "op-b", "finished");
  });

  it("يرفض نتيجة done قديمة بعد تحرير lease العملية", async () => {
    const turnId = "turn-late-done";
    const generation = await claimOperationLease("s-late-done", "op-late-done", turnId, () => true);
    const attempt = { ...attemptFor("at-late-done", 0, "op-late-done"), turnId };
    await persistTurnAttempt("s-late-done", turnId, attempt, "stateful", "سؤال", () => true, generation);
    const base = chatMessage("msg-late-done", "s-late-done", {
      turnId,
      role: "assistant",
      kind: "result",
      targetId: "t1",
      providerId: "openrouter",
      modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" },
      text: "بث",
      status: "streaming",
      operationId: "op-late-done",
      attemptId: "at-late-done",
      attempt: 1,
    });
    expect((await appendMessage(base)).accepted).toBe(true);
    await releaseOperationLease("s-late-done", "op-late-done", "cancelled");
    const result = await appendMessage({ ...base, text: "نجاح متأخر", status: "done" });
    expect(result.accepted).toBe(false);
    expect((await db.messages.get("msg-late-done"))?.status).toBe("streaming");
  });

  it("يتراجع عن محاولة عند إلغاء العملية بعد بدء كتابة المعاملة", async () => {
    let owned = true;
    const originalPut = db.turns.put.bind(db.turns);
    const putSpy = vi.spyOn(db.turns, "put").mockImplementation((...args) =>
      originalPut(...args).then((result) => {
        owned = false;
        return result;
      }),
    );

    try {
      const attempt = { ...attemptFor("at-cancel-at-commit", 0, "op-cancel-at-commit"), turnId: "turn-cancel-at-commit" };
      await expect(persistTurnAttempt("s-cancel-at-commit", "turn-cancel-at-commit", attempt, "stateful", "سؤال", () => owned)).rejects.toThrow();
      expect(await getTurn("turn-cancel-at-commit")).toBeUndefined();
    } finally {
      putSpy.mockRestore();
    }
  });

  it("يحوّل بطاقة legacy نهائية إلى محاولة identified حالية دون خفض الحالة", async () => {
    const sessionId = "s-legacy-upgrade";
    const turnId = "turn-legacy-upgrade";
    const attempt = { ...attemptFor("at-legacy-upgrade", 0, "op-legacy-upgrade"), turnId };
    await persistTurnAttempt(sessionId, turnId, attempt, "stateful", "سؤال", () => true);
    const coordinates = {
      turnId,
      role: "assistant" as const,
      kind: "result" as const,
      targetId: "t1",
      providerId: "openrouter" as const,
      modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" },
    };
    await db.messages.put(chatMessage("legacy-upgrade-card", sessionId, {
      ...coordinates,
      text: "نتيجة قديمة",
      status: "done",
      operationId: undefined,
      attemptId: undefined,
      attempt: undefined,
    }));

    const incoming = chatMessage("legacy-upgrade-card", sessionId, {
      ...coordinates,
      text: "بث المحاولة الجديدة",
      status: "streaming",
      operationId: attempt.operationId,
      attemptId: attempt.id,
      attempt: 1,
    });
    const result = await appendMessage(incoming);
    expect(result).toMatchObject({ accepted: true, current: incoming });
  });

  it("يسمح لمحاولة أعلى حالية باستبدال بطاقة طرفية بحالة طرفية مختلفة", async () => {
    const sessionId = "s-terminal-retry";
    const turnId = "turn-terminal-retry";
    const first = { ...attemptFor("at-terminal-retry-1", 0, "op-terminal-retry-1"), turnId };
    const second = { ...attemptFor("at-terminal-retry-2", 0, "op-terminal-retry-2"), turnId };
    await persistTurnAttempt(sessionId, turnId, first, "stateful", "سؤال", () => true);
    await persistTurnAttempt(sessionId, turnId, second, "stateful", "سؤال", () => true);
    const coordinates = {
      turnId,
      role: "assistant" as const,
      kind: "result" as const,
      targetId: "t1",
      providerId: "openrouter" as const,
      modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" },
    };
    await db.messages.put(chatMessage("terminal-retry-card", sessionId, {
      ...coordinates,
      text: "فشل سابق",
      status: "error",
      error: "old",
      operationId: first.operationId,
      attemptId: first.id,
      attempt: 1,
    }));
    const incoming = chatMessage("terminal-retry-card", sessionId, {
      ...coordinates,
      text: "نجاح حديث",
      status: "done",
      operationId: second.operationId,
      attemptId: second.id,
      attempt: 2,
    });
    const result = await appendMessage(incoming);
    expect(result).toMatchObject({ accepted: true, current: incoming });
  });

  it("يرفض حالة طرفية لا تطابق المحاولة canonical الحالية", async () => {
    const sessionId = "s-terminal-mismatch";
    const turnId = "turn-terminal-mismatch";
    const first = { ...attemptFor("at-terminal-mismatch-1", 0, "op-terminal-mismatch-1"), turnId };
    const second = { ...attemptFor("at-terminal-mismatch-2", 0, "op-terminal-mismatch-2"), turnId };
    await persistTurnAttempt(sessionId, turnId, first, "stateful", "سؤال", () => true);
    await persistTurnAttempt(sessionId, turnId, second, "stateful", "سؤال", () => true);
    const coordinates = {
      turnId,
      role: "assistant" as const,
      kind: "result" as const,
      targetId: "t1",
      providerId: "openrouter" as const,
      modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" },
    };
    const old = chatMessage("terminal-mismatch-card", sessionId, {
      ...coordinates,
      text: "بث المحاولة الأولى",
      status: "streaming",
      operationId: first.operationId,
      attemptId: first.id,
      attempt: 1,
    });
    await db.messages.put(old);
    await updateTurnAttemptStatus(turnId, second.id, "done", second.operationId);
    const incoming = { ...old, text: "خطأ متأخر", status: "error" as const, error: "bad", operationId: second.operationId, attemptId: second.id, attempt: 2 };
    const result = await appendMessage(incoming);
    expect(result.accepted).toBe(false);
    expect((await db.messages.get(old.id))?.status).toBe("streaming");
  });

  it("يرفض تحديث رسالة identified مفقودة TurnRecord حتى لو كانت هويتها كما هي", async () => {
    const row = chatMessage("identified-without-turn", "s-missing-turn", {
      role: "assistant",
      kind: "result",
      targetId: "t1",
      providerId: "openrouter" as const,
      modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" },
      status: "streaming",
      operationId: "op-missing-turn",
      attemptId: "at-missing-turn",
      attempt: 1,
    });
    await db.messages.put(row);
    const result = await appendMessage({ ...row, text: "تحديث غير موثق" });
    expect(result).toMatchObject({ accepted: false, reason: "stale" });
    expect((await db.messages.get(row.id))?.text).toBe("");
  });

  it("يمنع صفًا متأخرًا من الكتابة فوق بطاقة المحاولة الأعلى", async () => {
    const first = attemptFor("at-old", 1, "op-old");
    await persistTurnAttempt("s-guard", "turn-retry", first, "stateful", "سؤال", () => true);
    await appendMessage(chatMessage("card", "s-guard", {
      role: "assistant",
      kind: "result",
      targetId: "t1",
      providerId: "openrouter" as const,
      modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" },
      text: "النتيجة القديمة",
      operationId: "op-old",
      attemptId: "at-old",
      attempt: 1,
      turnId: "turn-retry",
    }));
    const replacement = attemptFor("at-new", 2, "op-new");
    await persistTurnAttempt("s-guard", "turn-retry", replacement, "stateful", "سؤال", () => true);
    await appendMessage(chatMessage("card", "s-guard", {
      role: "assistant",
      kind: "result",
      targetId: "t1",
      providerId: "openrouter" as const,
      modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" },
      text: "النتيجة الحديثة",
      operationId: "op-new",
      attemptId: "at-new",
      attempt: 2,
      turnId: "turn-retry",
    }));
    const forged = chatMessage("card", "s-guard", {
      role: "assistant",
      kind: "result",
      text: "رقم مزيف",
      operationId: "op-forged",
      attemptId: "at-forged",
      attempt: 99,
      turnId: "turn-retry",
    });
    expect((await appendMessage(forged)).accepted).toBe(false);
    expect((await appendMessage(chatMessage("card", "s-guard", {
      role: "assistant",
      kind: "result",
      text: "هوية ناقصة",
      operationId: "op-new",
      attemptId: undefined,
      attempt: 99,
      turnId: "turn-retry",
    }))).accepted).toBe(false);

    expect(await db.messages.get("card")).toMatchObject({
      text: "النتيجة الحديثة",
      operationId: "op-new",
      attemptId: "at-new",
      attempt: 2,
    });
  });

  it("يختار Attempt المحفوظة للهوية الكاملة ولا يخمّن المحاولة عند نقصها", async () => {
    const attempt = await persistTurnAttempt("s-retry-select", "turn-retry", attemptFor("at-retry-select", 0, "op-retry-select"), "stateful", "سؤال", () => true);
    const result: ChatMessage = {
      id: "retry-result", sessionId: "s-retry-select", turnId: "turn-retry", createdAt: 1,
      role: "assistant", kind: "result", text: "old", targetId: "t1", providerId: "openrouter", modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" }, status: "error",
      operationId: "op-retry-select", attemptId: attempt.id, attempt: attempt.attempt,
    };
    const record = await getTurn("turn-retry");
    expect(selectPersistedRetryAttempt(record, result, "t1")?.id).toBe(attempt.id);
    expect(() => selectPersistedRetryAttempt(record, { ...result, attemptId: undefined }, "t1")).toThrow();
    expect(() => selectPersistedRetryAttempt(record, { ...result, operationId: "op-forged" }, "t1")).toThrow();
    expect(() => selectPersistedRetryAttempt(record, { ...result, modelId: "forged" }, "t1")).toThrow();
  });

  it("يرفض تخمين محاولة legacy غير معرّفة عند وجود سجل durable", async () => {
    await persistTurnAttempt("s-legacy-retry", "turn-retry", attemptFor("at-legacy-retry", 0, "op-legacy-retry"), "stateful", "سؤال", () => true);
    const legacy = chatMessage("legacy-retry-card", "s-legacy-retry", { turnId: "turn-retry", role: "assistant", kind: "result", targetId: "t1", providerId: "openrouter", modelId: "model-1", modelInfo: { id: "model-1", label: "Model 1" }, operationId: undefined, attemptId: undefined, attempt: undefined });
    const record = await getTurn("turn-retry");
    expect(() => selectPersistedRetryAttempt(record, legacy, "t1")).toThrow();
    expect(() => selectPersistedRetryAttempt(record, { ...legacy, modelInfo: undefined }, "t1")).toThrow();
    expect(selectPersistedRetryAttempt(undefined, legacy, "t1")).toBeUndefined();
  });

  it("يرفض صفًا معرّفًا لا يطابق إحداثيات المحاولة الحالية", async () => {
    await persistTurnAttempt("s-target-identity", "turn-retry", attemptFor("at-target", 1, "op-target"), "stateful", "سؤال", () => true);
    const forged = chatMessage("forged-target", "s-target-identity", {
      turnId: "turn-retry", role: "assistant", kind: "result", targetId: "forged-target",
      providerId: "google", modelId: "forged-model", modelInfo: { id: "forged-model", label: "Forged" },
      operationId: "op-target", attemptId: "at-target", attempt: 1,
    });
    expect((await appendMessage(forged)).accepted).toBe(false);
  });

  it("يمنع Attempt القديمة من streaming بعد إنشاء محاولة أحدث", async () => {
    await persistTurnAttempt("s-old-stream", "turn-retry", attemptFor("at-old-stream", 1, "op-old-stream"), "stateful", "سؤال", () => true);
    const old = chatMessage("old-stream", "s-old-stream", {
      turnId: "turn-retry", role: "assistant", kind: "result", targetId: "t1", providerId: "openrouter" as const, modelId: "model-1", modelInfo: { id: "model-1", label: "Model 1" }, status: "streaming",
      operationId: "op-old-stream", attemptId: "at-old-stream", attempt: 1,
    });
    expect((await appendMessage(old)).accepted).toBe(true);
    await persistTurnAttempt("s-old-stream", "turn-retry", attemptFor("at-new-stream", 0, "op-new-stream"), "stateful", "سؤال", () => true);
    expect((await appendMessage({ ...old, text: "late" })).accepted).toBe(false);
  });

  it("يمنع تغيير promptKind وcreatedAt على صف durable موجود", async () => {
    await persistTurnAttempt("s-stable", "turn-retry", attemptFor("at-stable", 1, "op-stable"), "stateful", "سؤال", () => true);
    const original = chatMessage("stable-message", "s-stable", {
      turnId: "turn-retry", role: "user", kind: "prompt", promptKind: "shared", createdAt: 50,
      operationId: "op-stable", attemptId: "at-stable", attempt: 1,
    });
    expect((await appendMessage(original)).accepted).toBe(true);
    expect((await appendMessage({ ...original, promptKind: "custom" })).accepted).toBe(false);
    expect((await appendMessage({ ...original, createdAt: 51 })).accepted).toBe(false);
  });

  it("يتطلب هوية العملية لتحديث حالة Attempt معرّفة", async () => {
    await persistTurnAttempt("s-status-identity", "turn-retry", attemptFor("at-status", 1, "op-status"), "stateful", "سؤال", () => true);
    expect(await updateTurnAttemptStatus("turn-retry", "at-status", "done")).toBe(false);
    expect(await updateTurnAttemptStatus("turn-retry", "at-status", "done", "op-status")).toBe(true);
  });

  it("يسمح لل محاولة superseded بأن تنهي حالتها فقط بهويتها دون تحديث aggregate", async () => {
    await persistTurnAttempt("s-old-final", "turn-retry", attemptFor("at-old-final", 0, "op-old-final"), "stateful", "سؤال", () => true);
    await persistTurnAttempt("s-old-final", "turn-retry", attemptFor("at-new-final", 0, "op-new-final"), "stateful", "سؤال", () => true);
    expect(await supersedeTurnAttempts("turn-retry", ["at-old-final"])).toBe(true);
    expect(await updateTurnAttemptStatus("turn-retry", "at-old-final", "stopped", "op-old-final")).toBe(true);
    expect(await updateTurnAttemptStatus("turn-retry", "at-old-final", "streaming", "op-old-final")).toBe(false);
    expect((await getTurn("turn-retry"))?.attempts.find((attempt) => attempt.id === "at-old-final")?.status).toBe("stopped");
  });

  it("يحفظ علم superseded عند قبول تحديث terminal متأخر للمحاولة القديمة", async () => {
    const turnId = "turn-preserve-superseded";
    const oldAttempt = { ...attemptFor("at-preserve-old", 1, "op-preserve-old", [snapshotFor("t-old")]), turnId, status: "stopped" as const, superseded: true };
    const currentAttempt = { ...attemptFor("at-preserve-new", 2, "op-preserve-new", [snapshotFor("t-new")]), turnId, status: "streaming" as const };
    await putTurn(turnRecord(turnId, "s-preserve-superseded", { status: "streaming", attempts: [oldAttempt, currentAttempt] }));
    const existing = chatMessage("preserve-superseded", "s-preserve-superseded", {
      turnId, role: "assistant", kind: "result", targetId: "t-old", status: "stopped", superseded: true,
      providerId: "openrouter" as const, modelId: "model-1", modelInfo: { id: "model-1", label: "Model 1" },
      operationId: oldAttempt.operationId!, attemptId: oldAttempt.id, attempt: oldAttempt.attempt,
    });
    await db.messages.put(existing);

    const result = await appendMessage({ ...existing, superseded: false });
    expect(result.accepted).toBe(true);
    expect(result.current?.superseded).toBe(true);
    expect((await db.messages.get(existing.id))?.superseded).toBe(true);
  });

  it("يوقف Attempt superseded حتى لو كانت عمليتها في قائمة live", async () => {
    await putTurn(turnRecord("turn-superseded-live", "s-superseded-live", {
      status: "streaming",
      attempts: [{ ...attemptFor("at-superseded-live", 1, "op-superseded-live", [snapshotFor("t-live")]), turnId: "turn-superseded-live", superseded: true }],
    }));
    await db.messages.put(chatMessage("msg-superseded-live", "s-superseded-live", { turnId: "turn-superseded-live", role: "assistant", kind: "result", targetId: "t-live", status: "streaming", superseded: true, operationId: "op-superseded-live", attemptId: "at-superseded-live", attempt: 1 }));
    expect(await reconcileInterruptedTurns(new Set([liveOperationKey("s-superseded-live", "op-superseded-live")]))).toBe(1);
    expect((await getTurn("turn-superseded-live"))?.attempts[0]?.status).toBe("stopped");
    expect((await getTurn("turn-superseded-live"))?.status).toBe("stopped");
    expect(await db.messages.get("msg-superseded-live")).toMatchObject({ status: "stopped", error: INTERRUPTED_TURN_ERROR });
  });

  it("يفصل حيوية العمليات بين الجلسات حتى لو تكرر operationId", async () => {
    const attemptA = { ...attemptFor("at-shared-op", 1, "op-shared"), turnId: "turn-shared-a" };
    const attemptB = { ...attemptFor("at-shared-op-b", 1, "op-shared"), turnId: "turn-shared-b" };
    await persistTurnAttempt("session-a", "turn-shared-a", attemptA, "stateful", "سؤال", () => true);
    await persistTurnAttempt("session-b", "turn-shared-b", attemptB, "stateful", "سؤال", () => true);
    await appendMessage(chatMessage("msg-shared-a", "session-a", {
      turnId: "turn-shared-a", role: "assistant", kind: "result", targetId: "t1", providerId: "openrouter", modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" }, status: "streaming", operationId: "op-shared", attemptId: "at-shared-op", attempt: 1,
    }));
    await appendMessage(chatMessage("msg-shared-b", "session-b", {
      turnId: "turn-shared-b", role: "assistant", kind: "result", targetId: "t1", providerId: "openrouter", modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" }, status: "streaming", operationId: "op-shared", attemptId: "at-shared-op-b", attempt: 1,
    }));
    await reconcileInterruptedTurns(new Set([liveOperationKey("session-a", "op-shared")]));
    expect((await getTurn("turn-shared-a"))?.status).toBe("streaming");
    expect((await getTurn("turn-shared-b"))?.status).toBe("stopped");
    expect((await db.messages.get("msg-shared-b"))?.status).toBe("stopped");
  });

  it("يعيد aggregate turn إلى streaming عند وجود child حي حتى لو كان aggregate terminal", async () => {
    await putTurn(turnRecord("turn-terminal-live", "s-terminal-live", {
      status: "done",
      attempts: [{ ...attemptFor("at-terminal-live", 1, "op-terminal-live", [snapshotFor("t-live")]), turnId: "turn-terminal-live" }],
    }));
    await appendMessage(chatMessage("terminal-live-message", "s-terminal-live", {
      turnId: "turn-terminal-live", role: "assistant", kind: "result", status: "streaming",
      operationId: "op-terminal-live", attemptId: "at-terminal-live", attempt: 1,
    }));
    await reconcileInterruptedTurns(new Set([liveOperationKey("s-terminal-live", "op-terminal-live")]));
    expect((await getTurn("turn-terminal-live"))?.status).toBe("streaming");
  });

  it("يرفض كتابة العملية القديمة بعد جيل lease بديل مع السماح بحالة stopped", async () => {
    await createSession(session("lease-append"));
    await persistTurnAttempt("lease-append", "turn-retry", attemptFor("at-lease-a", 0, "op-lease-a"), "stateful", "سؤال", () => true);
    await claimOperationLease("lease-append", "op-lease-a", "turn-retry", () => true);
    const base = chatMessage("lease-card", "lease-append", {
      turnId: "turn-retry",
      role: "assistant",
      kind: "result",
      targetId: "t1",
      providerId: "openrouter" as const,
      modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" },
      text: "",
      status: "streaming",
      operationId: "op-lease-a",
      attemptId: "at-lease-a",
      attempt: 1,
    });
    expect((await appendMessage(base)).accepted).toBe(true);
    await claimOperationLease("lease-append", "op-lease-b", "turn-retry", () => true);
    expect((await appendMessage({ ...base, text: "late stream" })).accepted).toBe(false);
    expect((await appendMessage({ ...base, text: "late done", status: "done" })).accepted).toBe(false);
    expect((await appendMessage({ ...base, text: "partial", status: "stopped" })).accepted).toBe(true);
  });

  it("يرفض محاولة أعلى محفوظة لكنها ليست المحاولة الحالية", async () => {
    await persistTurnAttempt("s-current", "turn-retry", attemptFor("at-1", 1, "op-1"), "stateful", "سؤال", () => true);
    await appendMessage(chatMessage("card-current", "s-current", {
      turnId: "turn-retry", role: "assistant", kind: "result", targetId: "t1", providerId: "openrouter" as const, modelId: "model-1", modelInfo: { id: "model-1", label: "Model 1" },
      operationId: "op-1", attemptId: "at-1", attempt: 1,
    }));
    await persistTurnAttempt("s-current", "turn-retry", attemptFor("at-2", 0, "op-2"), "stateful", "سؤال", () => true);
    await persistTurnAttempt("s-current", "turn-retry", attemptFor("at-3", 0, "op-3"), "stateful", "سؤال", () => true);
    const stale = chatMessage("card-current", "s-current", {
      turnId: "turn-retry", role: "assistant", kind: "result", text: "stale",
      operationId: "op-2", attemptId: "at-2", attempt: 2,
    });
    expect((await appendMessage(stale)).accepted).toBe(false);
    expect((await db.messages.get("card-current"))?.attemptId).toBe("at-1");
  });

  it("يرفض استبدال بطاقة يفقد modelInfo أثناء ترقية المحاولة", async () => {
    const first = attemptFor("at-model-1", 1, "op-model-1");
    await persistTurnAttempt("s-model", "turn-retry", first, "stateful", "سؤال", () => true);
    const original = chatMessage("card-model", "s-model", {
      turnId: "turn-retry", role: "assistant", kind: "result", targetId: "t1",
      providerId: "openrouter" as const, modelId: "model-1", modelInfo: { id: "model-1", label: "Model 1" },
      operationId: "op-model-1", attemptId: "at-model-1", attempt: 1,
    });
    expect((await appendMessage(original)).accepted).toBe(true);
    await persistTurnAttempt("s-model", "turn-retry", attemptFor("at-model-2", 0, "op-model-2"), "stateful", "سؤال", () => true);
    const replacement = chatMessage("card-model", "s-model", {
      turnId: "turn-retry", role: "assistant", kind: "result", targetId: "t1",
      providerId: "openrouter" as const, modelId: "model-1",
      operationId: "op-model-2", attemptId: "at-model-2", attempt: 2,
    });
    expect((await appendMessage(replacement)).accepted).toBe(false);
  });

  it("يرفض استبدال بطاقة كاملة بهوية إحداثيات مختلفة", async () => {
    const attempt = attemptFor("at-coordinate", 1, "op-coordinate");
    await persistTurnAttempt("s-coordinate", "turn-retry", attempt, "stateful", "سؤال", () => true);
    const original = chatMessage("card-coordinate", "s-coordinate", {
      turnId: "turn-retry",
      role: "assistant",
      kind: "result",
      targetId: "t1",
      providerId: "openrouter" as const,
      modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" },
      text: "original",
      operationId: "op-coordinate",
      attemptId: "at-coordinate",
      attempt: 1,
    });
    expect((await appendMessage(original)).accepted).toBe(true);
    for (const coordinates of [
      { turnId: "other-turn" },
      { role: "user" as const },
      { kind: "prompt" as const },
      { targetId: "other-target" },
      { providerId: "google" as const },
      { modelId: "other-model" },
    ]) {
      const result = await appendMessage({ ...original, ...coordinates, text: "forged" });
      expect(result.accepted).toBe(false);
    }
    expect((await db.messages.get("card-coordinate"))?.text).toBe("original");
  });

  it("يرفض إعادة استخدام معرّف محاولة مع هوية أو لقطة مختلفة", async () => {
    const first = attemptFor("at-1", 77, "op-1", [snapshotFor("t1", "الأصل")]);
    const canonical = await persistTurnAttempt("s-attempts", first.turnId, first, "stateful", "سؤال", () => true);
    expect(canonical.attempt).toBe(1);
    expect(canonical.targets[0]?.customPrompt).toBe("الأصل");
    await expect(persistTurnAttempt("s-attempts", first.turnId, attemptFor("at-1", 999, "op-other", [snapshotFor("t1", "معدّل")]), "stateful", "سؤال", () => true)).rejects.toThrow();
    const record = await getTurn("turn-retry");
    expect(record?.attempts[0]).toMatchObject({ id: "at-1", operationId: "op-1", attempt: 1 });
    expect(record?.attempts[0]?.targets[0]?.customPrompt).toBe("الأصل");
  });

  it("يعطي أرقام محاولة تصاعدية ويحافظ على لقطة المحاولة نفسها", async () => {
    const first = attemptFor("at-1", 77, "op-1", [snapshotFor("t1", "الأصل")]);
    await persistTurnAttempt("s-attempts", first.turnId, first, "stateful", "سؤال", () => true);
    await persistTurnAttempt("s-attempts", first.turnId, attemptFor("at-2", 0, "op-2", [snapshotFor("t2", "الثاني")]), "stateful", "سؤال", () => true);
    await expect(persistTurnAttempt("s-attempts", first.turnId, attemptFor("at-1", 999, "op-other", [snapshotFor("t1", "معدّل")]), "stateful", "سؤال", () => true)).rejects.toThrow();

    const record = await getTurn("turn-retry");
    expect(record?.attempts.map((attempt) => attempt.attempt)).toEqual([1, 2]);
    expect(record?.attempts[0]).toMatchObject({ id: "at-1", attempt: 1, operationId: "op-1" });
    expect(record?.attempts[0]?.targets[0]?.customPrompt).toBe("الأصل");
  });

  it("يسمح بإعادة تفعيل البطاقة نفسها عند محاولة أعلى بعد supersede", async () => {
    await persistTurnAttempt("s-second-retry", "turn-retry", attemptFor("at-second-a", 0, "op-second-a"), "stateful", "سؤال", () => true);
    const original = chatMessage("second-retry-card", "s-second-retry", {
      turnId: "turn-retry", role: "assistant", kind: "result", targetId: "t1", providerId: "openrouter", modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" }, text: "old", status: "done", operationId: "op-second-a", attemptId: "at-second-a", attempt: 1, superseded: false,
    });
    expect((await appendMessage(original)).accepted).toBe(true);
    const second = await persistTurnAttempt("s-second-retry", "turn-retry", attemptFor("at-second-b", 0, "op-second-b"), "stateful", "سؤال", () => true);
    expect(await supersedeTurnAttempts("turn-retry", ["at-second-a"])).toBe(true);
    const replacement: ChatMessage = { ...original, text: "new", status: "streaming", operationId: second.operationId!, attemptId: second.id, attempt: second.attempt, superseded: false };
    expect((await appendMessage(replacement)).accepted).toBe(true);
    expect((await db.messages.get(original.id))?.attempt).toBe(2);
  });

  it("لا يعلّم بطاقة attemptId نفسه في دور آخر", async () => {
    await persistTurnAttempt("s-supersede-scope", "turn-retry", attemptFor("at-shared", 1, "op-shared"), "stateful", "سؤال", () => true);
    await putTurn(turnRecord("turn-other", "s-supersede-scope", { status: "done", attempts: [{ ...attemptFor("at-shared", 1, "op-shared"), turnId: "turn-other" }] }));
    await db.messages.put(chatMessage("unrelated-shared-attempt", "s-supersede-scope", { turnId: "turn-other", role: "assistant", kind: "result", operationId: "op-shared", attemptId: "at-shared", attempt: 1 }));
    expect(await supersedeTurnAttempts("turn-retry", ["at-shared"])).toBe(true);
    expect((await db.messages.get("unrelated-shared-attempt"))?.superseded).toBe(false);
  });

  it("يرفض supersede لمعرّف محاولة غير موجود ويحدث المحاولة الحالية", async () => {
    await persistTurnAttempt("s-supersede", "turn-retry", attemptFor("at-live", 1, "op-live"), "stateful", "سؤال", () => true);
    expect(await supersedeTurnAttempts("turn-retry", ["at-missing"])).toBe(false);
    expect(await updateTurnAttemptStatus("turn-retry", "at-live", "done", "op-wrong")).toBe(false);
    expect(await updateTurnAttemptStatus("turn-retry", "at-live", "done", "op-live")).toBe(true);
    expect((await getTurn("turn-retry"))?.attempts[0]?.status).toBe("done");
  });

  it("يرفض إعادة تشغيل هوية terminal مع تغيير النص أو الخطأ أو الاستهلاك", async () => {
    const sessionId = "s-terminal-replay";
    const turnId = "turn-terminal-replay";
    const attempt = {
      ...attemptFor("at-terminal-replay", 0, "op-terminal-replay"),
      turnId,
      status: "done" as const,
    };
    await persistTurnAttempt(sessionId, turnId, attempt, "stateful", "سؤال", () => true);
    const original = chatMessage("terminal-replay", sessionId, {
      turnId,
      role: "assistant",
      kind: "result",
      targetId: "t1",
      providerId: "openrouter" as const,
      modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" },
      text: "النتيجة الأصلية",
      status: "done",
      error: "unchanged",
      usage: { inputTokens: 1, outputTokens: 2, cachedInputTokens: 0, costUSD: null },
      operationId: attempt.operationId!,
      attemptId: attempt.id,
      attempt: 1,
    });
    expect((await appendMessage(original)).accepted).toBe(true);

    const replay = await appendMessage({
      ...original,
      text: "نتيجة معدلة",
      error: "تغيّر الخطأ",
      usage: { inputTokens: 9, outputTokens: 9, cachedInputTokens: 9, costUSD: 99 },
    });
    expect(replay).toMatchObject({ accepted: false, reason: "terminal" });
    expect(await db.messages.get(original.id)).toMatchObject({
      text: original.text,
      error: original.error,
      usage: original.usage,
    });
  });

  it("يرفض تغيير cacheWriteInputTokens في replay طرفي", async () => {
    const original = chatMessage("terminal-cache-write-replay", "s-terminal-cache-write-replay", {
      turnId: "turn-terminal-cache-write-replay",
      role: "assistant",
      kind: "result",
      targetId: "t1",
      providerId: "openrouter",
      modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" },
      text: "النتيجة",
      status: "done",
      usage: { inputTokens: 1, outputTokens: 2, cachedInputTokens: 0, cacheWriteInputTokens: 0, costUSD: null },
    });
    delete original.operationId;
    delete original.attemptId;
    delete original.attempt;
    await db.messages.put(original);

    const replay = await appendMessage({
      ...original,
      usage: { ...original.usage!, cacheWriteInputTokens: 9 },
    });
    expect(replay).toMatchObject({ accepted: false, reason: "terminal" });
    expect(await db.messages.get(original.id)).toMatchObject({ usage: original.usage });
  });

  it("يرفض تحديث streaming متأخر بعد أصبحت المحاولة طرفية", async () => {
    const sessionId = "s-terminal-late-update";
    const turnId = "turn-terminal-late-update";
    const attempt = { ...attemptFor("at-terminal-late-update", 0, "op-terminal-late-update"), turnId };
    await persistTurnAttempt(sessionId, turnId, attempt, "stateful", "سؤال", () => true);
    const placeholder = chatMessage("terminal-late-update", sessionId, {
      turnId,
      role: "assistant",
      kind: "result",
      targetId: "t1",
      providerId: "openrouter",
      modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" },
      text: "جزئي",
      status: "streaming",
      operationId: attempt.operationId,
      attemptId: attempt.id,
      attempt: 1,
    });
    expect((await appendMessage(placeholder)).accepted).toBe(true);
    expect((await appendMessage({ ...placeholder, text: "نهائي", status: "done" })).accepted).toBe(true);
    expect(await updateTurnAttemptStatus(turnId, attempt.id, "done", attempt.operationId)).toBe(true);

    const late = await appendMessage({ ...placeholder, text: "عودة إلى البث", status: "streaming" });
    expect(late).toMatchObject({ accepted: false, reason: "stale" });
    expect(await db.messages.get(placeholder.id)).toMatchObject({ text: "نهائي", status: "done" });
  });

  it("يرفض حالة رسالة طرفية لا تطابق المحاولة الطرفية رغم بقاء الصف streaming", async () => {
    const sessionId = "s-terminal-message-mismatch";
    const turnId = "turn-terminal-message-mismatch";
    const attempt = { ...attemptFor("at-terminal-message-mismatch", 0, "op-terminal-message-mismatch"), turnId };
    await persistTurnAttempt(sessionId, turnId, attempt, "stateful", "سؤال", () => true);
    const placeholder = chatMessage("terminal-message-mismatch", sessionId, {
      turnId,
      role: "assistant",
      kind: "result",
      targetId: "t1",
      providerId: "openrouter" as const,
      modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" },
      text: "النتيجة",
      status: "streaming",
      operationId: attempt.operationId,
      attemptId: attempt.id,
      attempt: 1,
    });
    expect((await appendMessage(placeholder)).accepted).toBe(true);
    expect(await updateTurnAttemptStatus(turnId, attempt.id, "done", attempt.operationId)).toBe(true);

    const mismatch = await appendMessage({ ...placeholder, status: "error", error: "تعارض طرفي" });
    expect(mismatch).toMatchObject({ accepted: false, reason: "stale" });
    expect(await db.messages.get(placeholder.id)).toMatchObject({ status: "streaming" });
    expect((await db.messages.get(placeholder.id))?.error).toBeUndefined();
  });

  it("يرفض placeholder streaming لمحاولة أحدث أصبحت طرفية", async () => {
    const sessionId = "s-terminal-newer-placeholder";
    const turnId = "turn-terminal-newer-placeholder";
    const first = { ...attemptFor("at-terminal-newer-first", 0, "op-terminal-newer-first"), turnId };
    await persistTurnAttempt(sessionId, turnId, first, "stateful", "سؤال", () => true);
    const original = chatMessage("terminal-newer-placeholder", sessionId, {
      turnId,
      role: "assistant",
      kind: "result",
      targetId: "t1",
      providerId: "openrouter",
      modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" },
      text: "قديمة",
      status: "done",
      operationId: first.operationId,
      attemptId: first.id,
      attempt: 1,
    });
    expect((await appendMessage(original)).accepted).toBe(true);
    const second = await persistTurnAttempt(sessionId, turnId, { ...attemptFor("at-terminal-newer-second", 0, "op-terminal-newer-second"), turnId }, "stateful", "سؤال", () => true);
    expect(await updateTurnAttemptStatus(turnId, second.id, "done", second.operationId)).toBe(true);

    const rejected = await appendMessage({ ...original, operationId: second.operationId, attemptId: second.id, attempt: second.attempt, text: "placeholder", status: "streaming" });
    expect(rejected).toMatchObject({ accepted: false, reason: "stale" });
    expect(await db.messages.get(original.id)).toMatchObject({ attempt: 1, text: "قديمة", status: "done" });
  });

  it("يرفض تغيير محتوى صف legacy طرفي من دون هوية", async () => {
    const legacy = chatMessage("legacy-terminal-replay", "s-legacy-terminal-replay", {
      turnId: "turn-legacy-terminal-replay",
      role: "assistant",
      kind: "result",
      targetId: "t1",
      providerId: "openrouter",
      modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" },
      text: "النتيجة الأصلية",
      status: "done",
    });
    delete legacy.operationId;
    delete legacy.attemptId;
    delete legacy.attempt;
    await db.messages.put(legacy);

    const changed = await appendMessage({ ...legacy, text: "نتيجة معدلة" });
    expect(changed).toMatchObject({ accepted: false, reason: "terminal" });
    expect(await db.messages.get(legacy.id)).toMatchObject({ text: legacy.text, status: "done" });
  });

  it("يرفض replay لمعرّف محاولة موجود مع حالة مختلفة", async () => {
    const sessionId = "s-attempt-replay-status";
    const turnId = "turn-attempt-replay-status";
    const original = { ...attemptFor("at-replay-status", 0, "op-replay-status"), turnId, status: "streaming" as const };
    await persistTurnAttempt(sessionId, turnId, original, "stateful", "سؤال", () => true);
    const conflicting = { ...original, attempt: 99, status: "done" as const };
    await expect(persistTurnAttempt(sessionId, turnId, conflicting, "stateful", "سؤال", () => true)).rejects.toThrow();
    expect((await getTurn(turnId))?.attempts[0]).toMatchObject({
      id: original.id,
      attempt: 1,
      status: "streaming",
    });
  });

  it("يرفض identified result ناقصة إحداثيات target", async () => {
    const sessionId = "s-missing-target";
    const turnId = "turn-missing-target";
    const attempt = { ...attemptFor("at-missing-target", 0, "op-missing-target"), turnId };
    await persistTurnAttempt(sessionId, turnId, attempt, "stateful", "سؤال", () => true);
    const partial = chatMessage("missing-target", sessionId, {
      turnId,
      role: "assistant",
      kind: "result",
      providerId: "openrouter" as const,
      modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" },
      operationId: attempt.operationId!,
      attemptId: attempt.id,
      attempt: 1,
    });
    expect((await appendMessage(partial)).accepted).toBe(false);
    expect(await db.messages.get(partial.id)).toBeUndefined();
  });

  it("يقبل أعلى محاولة صالحة دون وراثة superseded من البطاقة القديمة", async () => {
    const sessionId = "s-replacement-marker";
    const turnId = "turn-replacement-marker";
    const first = { ...attemptFor("at-replacement-old", 0, "op-replacement-old"), turnId };
    await persistTurnAttempt(sessionId, turnId, first, "stateful", "سؤال", () => true);
    const original = chatMessage("replacement-marker", sessionId, {
      turnId,
      role: "assistant",
      kind: "result",
      targetId: "t1",
      providerId: "openrouter" as const,
      modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" },
      text: "old",
      status: "done",
      operationId: first.operationId!,
      attemptId: first.id,
      attempt: 1,
      superseded: false,
    });
    expect((await appendMessage(original)).accepted).toBe(true);
    const second = await persistTurnAttempt(
      sessionId,
      turnId,
      { ...attemptFor("at-replacement-new", 0, "op-replacement-new"), turnId },
      "stateful",
      "سؤال",
      () => true,
    );
    expect(await supersedeTurnAttempts(turnId, [first.id])).toBe(true);
    const replacement: ChatMessage = {
      ...original,
      text: "new",
      status: "streaming",
      operationId: second.operationId!,
      attemptId: second.id,
      attempt: second.attempt,
      superseded: false,
    };
    const result = await appendMessage(replacement);
    expect(result).toMatchObject({ accepted: true, current: { attempt: 2, superseded: false } });
    expect(await db.messages.get(original.id)).toMatchObject({ attempt: 2, superseded: false });
  });

  it("يقبل replay تحذير sidecar ولا يمسح التحذير المثبت", async () => {
    const sessionId = "s-warning-replay";
    const turnId = "turn-warning-replay";
    const attempt = { ...attemptFor("at-warning-replay", 0, "op-warning-replay"), turnId, status: "done" as const };
    await persistTurnAttempt(sessionId, turnId, attempt, "stateful", "سؤال", () => true);
    const original = chatMessage("warning-replay", sessionId, {
      turnId,
      role: "assistant",
      kind: "result",
      targetId: "t1",
      providerId: "openrouter" as const,
      modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" },
      text: "النتيجة",
      status: "done",
      operationId: attempt.operationId!,
      attemptId: attempt.id,
      attempt: 1,
    });
    expect((await appendMessage(original)).accepted).toBe(true);
    const warned = { ...original, sidecarWarning: "تعذر حفظ الأرشفة" };
    expect((await appendMessage(warned)).accepted).toBe(true);
    const replayWithoutWarning = await appendMessage({ ...warned, sidecarWarning: undefined });
    expect(replayWithoutWarning).toMatchObject({
      accepted: true,
      current: { sidecarWarning: warned.sidecarWarning },
    });
    expect((await db.messages.get(original.id))?.sidecarWarning).toBe(warned.sidecarWarning);
  });

  it("يرفض جيل المحاولة القديم ويستخدم رقم المحاولة canonical في الرسالة", async () => {
    const sessionId = "s-canonical-cas";
    const turnId = "turn-canonical-cas";
    const generationA = await claimOperationLease(sessionId, "op-canonical-a", turnId, () => true);
    const generationB = await claimOperationLease(sessionId, "op-canonical-b", turnId, () => true);
    const oldAttempt = { ...attemptFor("at-canonical-a", 77, "op-canonical-a"), turnId };
    await expect(
      persistTurnAttempt(sessionId, turnId, oldAttempt, "stateful", "سؤال", () => true, generationA),
    ).rejects.toThrow();
    const canonical = await persistTurnAttempt(
      sessionId,
      turnId,
      { ...attemptFor("at-canonical-b", 0, "op-canonical-b"), turnId },
      "stateful",
      "سؤال",
      () => true,
      generationB,
    );
    expect(canonical.attempt).toBe(1);
    const message = chatMessage("canonical-cas", sessionId, {
      turnId,
      role: "assistant",
      kind: "result",
      targetId: "t1",
      providerId: "openrouter" as const,
      modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" },
      text: "canonical",
      status: "streaming",
      operationId: canonical.operationId,
      attemptId: canonical.id,
      attempt: canonical.attempt,
    });
    expect((await appendMessage(message)).accepted).toBe(true);
    expect((await db.messages.get(message.id))?.attempt).toBe(canonical.attempt);
    expect(await releaseOperationLease(sessionId, "op-canonical-b", "finished")).toBe(true);
  });

  it("يعزل reconciliation بين turnId متطابق في جلستين", async () => {
    const sessionA = "s-composite-a";
    const sessionB = "s-composite-b";
    const turnId = "turn-composite";
    const attempt = { ...attemptFor("at-composite", 0, "op-composite"), turnId };
    await persistTurnAttempt(sessionA, turnId, attempt, "stateful", "سؤال", () => true);
    const foreign = chatMessage("foreign-composite", sessionB, {
      turnId,
      role: "assistant",
      kind: "result",
      targetId: "t1",
      providerId: "openrouter" as const,
      modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" },
      text: "نص الجلسة الأخرى",
      status: "streaming",
      operationId: "op-composite",
      attemptId: attempt.id,
      attempt: 1,
    });
    await db.messages.put(foreign);
    expect(await reconcileInterruptedTurns(new Set([liveOperationKey(sessionA, "op-composite")]))).toBe(1);
    expect(await getTurn(turnId)).toMatchObject({ sessionId: sessionA, status: "streaming" });
    expect(await db.messages.get(foreign.id)).toMatchObject({
      sessionId: sessionB,
      turnId,
      text: foreign.text,
      operationId: foreign.operationId,
      status: "stopped",
      error: INTERRUPTED_TURN_ERROR,
    });
  });

  it("يحفظ رسالة identified live حية حتى عندما لا يحتوي TurnRecord على attempts", async () => {
    const sessionId = "s-live-without-attempt";
    const turnId = "turn-live-without-attempt";
    await putTurn(turnRecord(turnId, sessionId, { status: "pending", attempts: [] }));
    const message = chatMessage("live-without-attempt", sessionId, {
      turnId,
      role: "assistant",
      kind: "result",
      targetId: "t1",
      providerId: "openrouter" as const,
      modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" },
      text: "نص حي بلا attempt",
      status: "pending",
      operationId: "op-live-without-attempt",
      attemptId: "at-live-without-attempt",
      attempt: 1,
    });
    await db.messages.put(message);
    expect(await reconcileInterruptedTurns(new Set([liveOperationKey(sessionId, message.operationId!)]))).toBe(1);
    expect(await getTurn(turnId)).toMatchObject({ sessionId, status: "streaming", attempts: [] });
    expect(await db.messages.get(message.id)).toMatchObject({
      text: message.text,
      status: "pending",
      operationId: message.operationId,
      attemptId: message.attemptId,
      attempt: 1,
    });
  });

  it("لا يثق بهوية رسالة حية ناقصة أو لا تطابق محاولة canonical", async () => {
    const sessionId = "s-invalid-live-identity";
    const turnId = "turn-invalid-live-identity";
    await putTurn(turnRecord(turnId, sessionId, { status: "streaming", attempts: [] }));
    const partial = chatMessage("invalid-live-partial", sessionId, {
      turnId, role: "assistant", kind: "result", targetId: "t1", status: "streaming",
      operationId: "op-invalid-live-partial", attemptId: undefined, attempt: undefined,
    });
    await db.messages.put(partial);
    const attempt = await persistTurnAttempt(sessionId, turnId, { ...attemptFor("at-invalid-live", 0, "op-invalid-live"), turnId }, "stateful", "سؤال", () => true);
    const mismatched = chatMessage("invalid-live-mismatch", sessionId, {
      turnId, role: "assistant", kind: "result", targetId: "t1", status: "streaming",
      operationId: attempt.operationId, attemptId: "at-not-canonical", attempt: attempt.attempt,
    });
    await db.messages.put(mismatched);

    await reconcileInterruptedTurns(new Set([
      liveOperationKey(sessionId, "op-invalid-live-partial"),
      liveOperationKey(sessionId, attempt.operationId!),
    ]));
    expect(await db.messages.get(partial.id)).toMatchObject({ status: "stopped", error: INTERRUPTED_TURN_ERROR });
    expect(await db.messages.get(mismatched.id)).toMatchObject({ status: "stopped", error: INTERRUPTED_TURN_ERROR });
  });

  it("يوقف stale unknown live attempt ولا يخلطه مع جلسة العملية الحية", async () => {
    const liveSession = "s-unknown-live";
    const staleSession = "s-unknown-stale";
    const liveTurn = "turn-unknown-live";
    const staleTurn = "turn-unknown-stale";
    const liveAttempt = { ...attemptFor("at-unknown-live", 0, "op-unknown-live"), turnId: liveTurn };
    const staleAttempt = { ...attemptFor("at-unknown-stale", 0, "op-unknown-stale"), turnId: staleTurn };
    await persistTurnAttempt(liveSession, liveTurn, liveAttempt, "stateful", "سؤال", () => true);
    await persistTurnAttempt(staleSession, staleTurn, staleAttempt, "stateful", "سؤال", () => true);
    expect(await reconcileInterruptedTurns(new Set([liveOperationKey(liveSession, "op-unknown-live")]))).toBe(1);
    expect(await getTurn(liveTurn)).toMatchObject({ sessionId: liveSession, status: "streaming" });
    expect(await getTurn(staleTurn)).toMatchObject({ sessionId: staleSession, status: "stopped" });
    expect((await getTurn(staleTurn))?.attempts[0]).toMatchObject({
      id: staleAttempt.id,
      operationId: staleAttempt.operationId,
      status: "stopped",
    });
  });

  it("يرفض forged higher attempt ولا يغير البطاقة الحالية", async () => {
    const sessionId = "s-forged-higher";
    const turnId = "turn-forged-higher";
    const first = { ...attemptFor("at-forged-first", 0, "op-forged-first"), turnId };
    const current = { ...attemptFor("at-forged-current", 0, "op-forged-current"), turnId };
    await persistTurnAttempt(sessionId, turnId, first, "stateful", "سؤال", () => true);
    const original = chatMessage("forged-higher-card", sessionId, {
      turnId,
      role: "assistant",
      kind: "result",
      targetId: "t1",
      providerId: "openrouter" as const,
      modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" },
      text: "current",
      status: "streaming",
      operationId: first.operationId!,
      attemptId: first.id,
      attempt: 1,
    });
    expect((await appendMessage(original)).accepted).toBe(true);
    await persistTurnAttempt(sessionId, turnId, current, "stateful", "سؤال", () => true);
    const currentMessage = { ...original, operationId: current.operationId!, attemptId: current.id, attempt: 2, text: "current-2" };
    expect((await appendMessage(currentMessage)).accepted).toBe(true);
    const forged = { ...currentMessage, operationId: "op-forged", attemptId: "at-forged", attempt: 99, text: "forged" };
    expect((await appendMessage(forged)).accepted).toBe(false);
    expect(await db.messages.get(original.id)).toMatchObject({
      text: "current-2",
      operationId: current.operationId,
      attemptId: current.id,
      attempt: 2,
    });
  });

  it("يرفض append ذا هوية جزئية أو turn/session مختلف", async () => {
    const sessionId = "s-append-coordinates";
    const turnId = "turn-append-coordinates";
    const attempt = { ...attemptFor("at-append-coordinates", 0, "op-append-coordinates"), turnId };
    await persistTurnAttempt(sessionId, turnId, attempt, "stateful", "سؤال", () => true);
    const original = chatMessage("append-coordinates", sessionId, {
      turnId,
      role: "assistant",
      kind: "result",
      targetId: "t1",
      providerId: "openrouter" as const,
      modelId: "model-1",
      modelInfo: { id: "model-1", label: "Model 1" },
      text: "original",
      status: "streaming",
      operationId: attempt.operationId!,
      attemptId: attempt.id,
      attempt: 1,
    });
    expect((await appendMessage(original)).accepted).toBe(true);
    for (const candidate of [
      { ...original, sessionId: "s-other-session" },
      { ...original, turnId: "turn-other" },
      { ...original, attemptId: undefined },
    ]) {
      expect((await appendMessage(candidate)).accepted).toBe(false);
    }
    expect(await db.messages.get(original.id)).toMatchObject({
      sessionId,
      turnId,
      text: "original",
      attemptId: attempt.id,
      attempt: 1,
    });
  });
});
