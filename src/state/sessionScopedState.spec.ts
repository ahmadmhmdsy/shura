import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionsStore } from "./sessionsStore";
import { useComposerStore } from "./composerStore";
import * as repos from "@/lib/db/repos";
import { chatMessage } from "@/test/helpers";
import type { ChatMessage, SessionMeta, TargetConfig } from "@/types";

// المرجع: .superpowers/sdd/hardening-task-3-brief.md الخطوتان 1 و4 —
// مسودة الجلسة المعزولة، وحمولة getMessages الخاسرة للسباق تُرمى بحسب الجيل،
// ومسودة الجلسة المحذوفة تُمسح فورًا، والعمليات المحلية المتأخرة مقيدة بالجلسة المفتوحة.

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** الوسيط الثاني (sessionId) مطلوب في chatMessage — الاختبار يهتم بالمعرّف فقط */
const message = (id: string): ChatMessage => chatMessage(id, id);

const target: TargetConfig = {
  targetId: "t1", providerId: "openrouter", modelId: "openai/gpt-4o",
  modelInfo: { id: "openai/gpt-4o", label: "GPT-4o" },
};

beforeEach(() => {
  useSessionsStore.setState({ sessions: [], currentId: null, messages: [], loading: false, loadGeneration: 0, openGeneration: 0 });
  useComposerStore.setState({ drafts: {} });
  vi.restoreAllMocks();
});

it("does not expose A's draft in B", () => {
  useComposerStore.getState().setDraft("session-a", { sharedPrompt: "\u0633\u0624\u0627\u0644 A", targets: [target] });
  expect(useComposerStore.getState().getDraft("session-b").sharedPrompt).toBe("");
});

describe("setTargets persists into SessionMeta", () => {
  it("writes Dexie and the local meta only when targets actually change", async () => {
    useSessionsStore.setState({ sessions: [{ id: "s", title: "", createdAt: 0, updatedAt: 0, modelIds: [], primaryTarget: null, layoutMode: "vertical", onDisk: false }] });
    const updateSpy = vi.spyOn(repos, "updateSession").mockResolvedValue(undefined);
    await useSessionsStore.getState().setTargets("s", [target]);
    const meta = useSessionsStore.getState().sessions.find((x) => x.id === "s")!;
    expect(meta.targets).toEqual([target]);
    expect(updateSpy).toHaveBeenCalledWith("s", { targets: [target] });
    updateSpy.mockClear();
    // نفس القيمة قيميًا ⇒ لا كتابة Dexie صامتة (لا تزيح updatedAt في كل رندر)
    await useSessionsStore.getState().setTargets("s", [{ ...target }]);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("rejection propagates and the local meta rolls back when it still holds the attempted value", async () => {
    useSessionsStore.setState({ sessions: [{ id: "s", title: "", createdAt: 0, updatedAt: 0, modelIds: [], primaryTarget: null, layoutMode: "vertical", onDisk: false }] });
    const attempted = [{ ...target, targetId: "attempted" }] as TargetConfig[];
    vi.spyOn(repos, "updateSession").mockRejectedValue(new Error("تخزين معطل"));
    await expect(useSessionsStore.getState().setTargets("s", attempted)).rejects.toThrow("تخزين معطل");
    // التراجع المحلي يجرد القيمة التي فشل حفظها — لا يبدو النجاح زائفًا
    const meta = useSessionsStore.getState().sessions.find((x) => x.id === "s")!;
    expect(meta.targets).toBeUndefined();
  });

  it("an older rejected setTargets does not clobber a newer target selection", async () => {
    useSessionsStore.setState({ sessions: [{ id: "s", title: "", createdAt: 0, updatedAt: 0, modelIds: [], primaryTarget: null, layoutMode: "vertical", onDisk: false, targets: [target] }] });
    const attempted = [{ ...target, targetId: "attempted" }] as TargetConfig[];
    const stale = deferred<void>();
    const newer = deferred<void>();
    vi.spyOn(repos, "updateSession")
      .mockReturnValueOnce(stale.promise as never)
      .mockReturnValueOnce(newer.promise as never);
    const first = useSessionsStore.getState().setTargets("s", attempted);
    const newerTargets = [{ ...target, targetId: "newer" }] as TargetConfig[];
    const second = useSessionsStore.getState().setTargets("s", newerTargets);
    stale.reject(new Error("قديم فشل"));
    await expect(first).rejects.toThrow("قديم فشل");
    // القيمة الحية لم تعد القيمة التي فشل عليها الطلب القديم — لا تراجع يطغى على الاختيار الأحدث
    const meta = useSessionsStore.getState().sessions.find((x) => x.id === "s")!;
    expect(meta.targets).toEqual(newerTargets);
    newer.resolve(undefined);
    await second;
    expect(meta.targets).toEqual(newerTargets);
  });
});

describe("open seeds the draft from SessionMeta.targets", () => {
  it("seeds a fresh session's draft targets without overwriting an existing draft", async () => {
    vi.spyOn(repos, "getMessages").mockResolvedValue([message("m")]);
    useSessionsStore.setState({
      sessions: [
        { id: "withTargets", title: "", createdAt: 0, updatedAt: 0, modelIds: [], primaryTarget: null, layoutMode: "vertical", onDisk: false, targets: [target] },
        { id: "plain", title: "", createdAt: 0, updatedAt: 0, modelIds: [], primaryTarget: null, layoutMode: "vertical", onDisk: false },
      ],
    });
    await useSessionsStore.getState().open("withTargets");
    expect(useComposerStore.getState().getDraft("withTargets").targets).toEqual([target]);
    await useSessionsStore.getState().open("plain");
    expect(useComposerStore.getState().getDraft("plain").targets).toEqual([]);
    // مسودة مكتوبة سابقًا تبقى هي الأحدث — لا تُستبدل ببذرة بيانات الجلسة
    useComposerStore.getState().setDraft("plain", { sharedPrompt: "مكتوبة", targets: [target] });
    const seeded = [{ ...target, targetId: "seed" }] as TargetConfig[];
    useSessionsStore.setState({ sessions: useSessionsStore.getState().sessions.map((x) => (x.id === "plain" ? { ...x, targets: seeded } : x)) });
    await useSessionsStore.getState().open("plain");
    expect(useComposerStore.getState().getDraft("plain").sharedPrompt).toBe("مكتوبة");
    expect(useComposerStore.getState().getDraft("plain").targets.map((t) => t.targetId)).toEqual(["t1"]);
  });
});

describe("open-generation race guards", () => {
  it("discards a message load that lost the open-generation race", async () => {
    const first = deferred<ChatMessage[]>();
    const second = deferred<ChatMessage[]>();
    vi.spyOn(repos, "getMessages")
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const openA = useSessionsStore.getState().open("a");
    const openB = useSessionsStore.getState().open("b");
    second.resolve([message("b")]);
    await openB;
    first.resolve([message("a")]);
    await openA;
    expect(useSessionsStore.getState().currentId).toBe("b");
    expect(useSessionsStore.getState().messages).toEqual([message("b")]);
  });

  it("remove clears the deleted session's composer draft", async () => {
    vi.spyOn(repos, "getMessages").mockResolvedValue([message("gone")]);
    // Durable deletion needs a real session row: an unknown id must not be "deleted".
    const gone = { id: "gone", title: "ذهبت", createdAt: 0, updatedAt: 0, modelIds: [], primaryTarget: null, layoutMode: "vertical" as const, onDisk: false };
    await repos.createSession(gone);
    useSessionsStore.setState({ sessions: [gone] });
    await useSessionsStore.getState().open("gone");
    useComposerStore.getState().setShared("gone", "\u0645\u0633\u0648\u062F\u0629");
    expect(useComposerStore.getState().getDraft("gone").sharedPrompt).not.toBe("");
    await useSessionsStore.getState().remove("gone");
    expect(useComposerStore.getState().getDraft("gone").sharedPrompt).toBe("");
    expect(useSessionsStore.getState().currentId).toBeNull();
    expect(useSessionsStore.getState().messages).toEqual([]);
  });
});

describe("late local operations are scoped to the open session", () => {
  it("appendMessageLocal for another session mirrors only Dexie, not the open list", async () => {
    await useSessionsStore.getState().open("current");
    // This suite isolates open-session scoping. Use admissible legacy rows so
    // Task 6 canonical-attempt validation does not reject the durable write first.
    const legacy = (id: string, sessionId: string): ChatMessage => chatMessage(id, sessionId, {
      operationId: undefined, attemptId: undefined, attempt: undefined,
    });
    const other = legacy("m1", "other");
    await useSessionsStore.getState().appendMessageLocal(other);
    expect(useSessionsStore.getState().messages).toEqual([]);
    const mine = legacy("m2", "current");
    await useSessionsStore.getState().appendMessageLocal(mine);
    expect(useSessionsStore.getState().messages).toEqual([mine]);
  });

  it("upsertMessagesLocal drops messages of sessions not open", () => {
    useSessionsStore.setState({ currentId: "a", messages: [chatMessage("k1", "a")] });
    useSessionsStore.getState().upsertMessagesLocal([chatMessage("k2", "b"), chatMessage("k1", "a", { text: "محدّثة" })]);
    const msgs = useSessionsStore.getState().messages;
    expect(msgs.map((m) => m.id)).toEqual(["k1"]);
    expect(msgs[0]?.text).toBe("\u0645\u062D\u062F\u0651\u062B\u0629");
  });

  it("patchMessage cannot touch a message of another session", () => {
    useSessionsStore.setState({ currentId: "a", messages: [chatMessage("k1", "a"), chatMessage("k2", "b")] });
    useSessionsStore.getState().patchMessage("k2", { text: "اختراق" });
    expect(useSessionsStore.getState().messages.find((m) => m.id === "k2")?.text).toBe("");
    useSessionsStore.getState().patchMessage("k1", { text: "محلي" });
    expect(useSessionsStore.getState().messages.find((m) => m.id === "k1")?.text).toBe("\u0645\u062D\u0644\u064A");
  });
});
describe("rejected loads clear loading (hardening task 3)", () => {
  // المرجع: .superpowers/sdd/hardening-task-3-loading-fix.md — فشل الطلب الحالي
  // يستحق رفع الحاجب، والفشل العتيق لا يُسقط حاجب طلب أحدث ما زال جاريًا.

  it("load() rejection propagates and loading returns to false", async () => {
    vi.spyOn(repos, "listSessions").mockRejectedValue(new Error("قاعدة القوائم معطلة"));
    await expect(useSessionsStore.getState().load()).rejects.toThrow("قاعدة القوائم معطلة");
    expect(useSessionsStore.getState().loading).toBe(false);
  });

  it("a rejected stale load() does not clobber a newer in-flight load()", async () => {
    const stale = deferred<SessionMeta[]>();
    const newer = deferred<SessionMeta[]>();
    vi.spyOn(repos, "listSessions")
      .mockReturnValueOnce(stale.promise as never)
      .mockReturnValueOnce(newer.promise as never);
    const first = useSessionsStore.getState().load();
    const second = useSessionsStore.getState().load();
    stale.reject(new Error("stale"));
    await expect(first).rejects.toThrow("stale");
    // الطلب الأحدث ما زال جاريًا — الرفض العتيق لا يُسقط الحاجب بدلًا منه
    expect(useSessionsStore.getState().loading).toBe(true);
    newer.resolve([]);
    await second;
    expect(useSessionsStore.getState().loading).toBe(false);
    expect(useSessionsStore.getState().sessions).toEqual([]);
  });

  it("open() rejection propagates and loading returns to false", async () => {
    vi.spyOn(repos, "getMessages").mockRejectedValue(new Error("قاعدة الرسائل معطلة"));
    const opening = useSessionsStore.getState().open("a");
    await expect(opening).rejects.toThrow("قاعدة الرسائل معطلة");
    expect(useSessionsStore.getState().loading).toBe(false);
  });

  it("a rejected stale open() does not clobber a newer open()", async () => {
    const stale = deferred<ChatMessage[]>();
    const newer = deferred<ChatMessage[]>();
    vi.spyOn(repos, "getMessages")
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(newer.promise);
    const openA = useSessionsStore.getState().open("a");
    const openB = useSessionsStore.getState().open("b");
    stale.reject(new Error("stale"));
    await expect(openA).rejects.toThrow("stale");
    // فتح أحدث ("b") ما زال جاريًا — الرفض العتيق لا يلمس الحاجب ولا الرسائل
    expect(useSessionsStore.getState().currentId).toBe("b");
    expect(useSessionsStore.getState().loading).toBe(true);
    newer.resolve([message("b2")]);
    await openB;
    expect(useSessionsStore.getState().loading).toBe(false);
    expect(useSessionsStore.getState().messages).toEqual([message("b2")]);
  });
});
