import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { uiText } from "@/i18n";
import { en } from "@/i18n/en";
import { useSessionsStore } from "./sessionsStore";
import { useComposerStore } from "./composerStore";
import { sessionOperationCoordinator } from "@/lib/chat/operationCoordinator";
import { appendMessage, createSession, getMessages, getSession, recordUsage } from "@/lib/db/repos";
import { db } from "@/lib/db/db";
import type { ChatMessage, SessionMeta } from "@/types";

const session: SessionMeta = {
  id: "store-session",
  title: "مخزن",
  createdAt: 1,
  updatedAt: 1,
  modelIds: [],
  primaryTarget: null,
  layoutMode: "vertical",
  onDisk: false,
};

const row = (patch: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "store-row",
  sessionId: session.id,
  turnId: "store-turn",
  createdAt: 1,
  role: "assistant",
  kind: "result",
  text: "done",
  providerId: "openrouter",
  modelId: "model",
  targetId: "target",
  status: "done",
  ...patch,
});

beforeEach(() => {
  useSessionsStore.setState({ sessions: [session], currentId: session.id, messages: [] });
});

// [T3.2a] العنوان الافتراضي يُكتب بلغة الواجهة النشطة وقت الإنشاء، ثم يبقى بياناتٍ مخزَّنة.
describe("default session title (T3.2a)", () => {
  afterEach(() => uiText.setLocale("ar"));

  it("يُخزَّن عنوان الجلسة الجديدة بلغة الواجهة النشطة", async () => {
    uiText.setLocale("en");
    const meta = await useSessionsStore.getState().newSession();
    expect(meta.title).toBe(en.app.newSession);
    expect((await getSession(meta.id))?.title).toBe(en.app.newSession);
  });
});

describe("sessionsStore durable append guard", () => {
  it("does not publish a rejected partial-identity append", async () => {
    const result = await useSessionsStore.getState().appendMessageLocal(row({
      operationId: "op",
      attemptId: undefined,
      attempt: 1,
    }));
    expect(result.accepted).toBe(false);
    expect(useSessionsStore.getState().messages).toEqual([]);
  });

  it("does not publish an accepted append after the caller guard becomes stale", async () => {
    let allowed = true;
    const pending = useSessionsStore.getState().appendMessageLocal(row({ status: "streaming" }), () => allowed);
    allowed = false;
    expect((await pending).accepted).toBe(true);
    expect(useSessionsStore.getState().messages).toEqual([]);
  });

  it("does not publish a guarded local upsert after the view is stale", () => {
    useSessionsStore.getState().upsertMessagesLocal([row({ text: "stale" })], { canPublish: () => false });
    expect(useSessionsStore.getState().messages).toEqual([]);
  });

  it("replaces an accepted row by id instead of duplicating it", async () => {
    const first = await useSessionsStore.getState().appendMessageLocal(row({ status: "streaming" }));
    expect(first.accepted).toBe(true);
    const second = await useSessionsStore.getState().appendMessageLocal(row({ status: "streaming", text: "updated" }));
    expect(second.accepted).toBe(true);
    expect(useSessionsStore.getState().messages).toHaveLength(1);
    expect(useSessionsStore.getState().messages[0]?.text).toBe("updated");
  });
});

describe("sessionsStore durable removal", () => {
  it("يلغي العملية الحيّة ويصرّفها قبل الحذف ولا يسمح بكتابة متأخرة", async () => {
    const id = "store-remove-session";
    await createSession({ ...session, id });
    await appendMessage({ ...row({ id: "before-delete", sessionId: id }) });
    useComposerStore.getState().setDraft(id, { sharedPrompt: "مسودة" });
    useSessionsStore.setState({ sessions: [{ ...session, id }], currentId: id, messages: [] });

    const handle = sessionOperationCoordinator.start(id, "send", new AbortController())!;
    let drained = false;
    // The operation owner unwinds asynchronously once it observes the abort, exactly
    // like ChatScreen's durable finalizers; remove() must wait for that drain.
    handle.controller.signal.addEventListener("abort", () => {
      setTimeout(() => { drained = true; sessionOperationCoordinator.finish(handle.id, id); }, 0);
    }, { once: true });

    await useSessionsStore.getState().remove(id);

    expect(drained, "removal must wait for the canceled operation to drain").toBe(true);
    expect(sessionOperationCoordinator.activeFor(id)).toBeNull();
    expect(await getSession(id)).toBeUndefined();
    expect(await getMessages(id)).toEqual([]);
    expect(useComposerStore.getState().drafts[id]).toBeUndefined();
    expect(useSessionsStore.getState().sessions.some((s) => s.id === id)).toBe(false);

    // A late write from the drained operation must not recreate the session rows.
    const late = await appendMessage({ ...row({ id: "late-row", sessionId: id }), operationId: handle.id, attemptId: "at-late", attempt: 1, status: "error" });
    expect(late.accepted).toBe(false);
    await recordUsage({
      id: "u-late", sessionId: id, turnId: "turn-late", ts: 1, providerId: "openrouter",
      modelId: "model", inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUSD: null,
      toolCalls: 0, durationMs: 1, status: "ok",
    }).catch(() => undefined);
    expect(await db.usage_events.where("sessionId").equals(id).count()).toBe(0);
  });
});

describe("sessionsStore terminal patch guard", () => {
  it("rejects a partial incoming identity over an explicitly legacy local row", () => {
    const legacy = row({ operationId: undefined, attemptId: undefined, attempt: undefined, status: "streaming", text: "legacy" });
    useSessionsStore.setState({ messages: [legacy] });
    useSessionsStore.getState().upsertMessagesLocal([row({ operationId: "op-partial", attemptId: undefined, attempt: 1, status: "streaming", text: "partial" })]);
    expect(useSessionsStore.getState().messages[0]).toMatchObject({ text: "legacy", operationId: undefined, attemptId: undefined, attempt: undefined });
  });

  it("does not downgrade a terminal row or mutate immutable identity", () => {
    const terminal = row({ operationId: "op", attemptId: "at", attempt: 1 });
    useSessionsStore.setState({ messages: [terminal] });
    const state = useSessionsStore.getState();
    state.patchMessage(terminal.id, { status: "streaming" });
    expect(useSessionsStore.getState().messages[0]?.status).toBe("done");
    state.patchMessage(terminal.id, { attempt: 99, text: "still done" });
    const current = useSessionsStore.getState().messages[0];
    expect(current?.attempt).toBe(1);
    expect(current?.text).toBe("done");
  });

  it("blocks every terminal status replacement and stable coordinate mutation", () => {
    const terminal = row({ operationId: "op", attemptId: "at", attempt: 1, promptKind: "custom", modelInfo: { id: "m", label: "M" } });
    useSessionsStore.setState({ messages: [terminal] });
    const state = useSessionsStore.getState();
    state.patchMessage(terminal.id, { status: "error" });
    state.patchMessage(terminal.id, { createdAt: 99 });
    state.patchMessage(terminal.id, { promptKind: "shared" });
    state.patchMessage(terminal.id, { modelInfo: { id: "forged", label: "Forged" } });
    expect(useSessionsStore.getState().messages[0]).toMatchObject({ status: "done", createdAt: 1, promptKind: "custom", modelInfo: { id: "m" } });
  });

  it("allows a strictly newer attempt to replace a durable row without weakening terminal guards", () => {
    const first = row({ operationId: "op-1", attemptId: "at-1", attempt: 1, status: "done", text: "old" });
    useSessionsStore.setState({ messages: [first] });
    const state = useSessionsStore.getState();
    state.upsertMessagesLocal([row({ operationId: "op-2", attemptId: "at-2", attempt: 2, status: "done", text: "new" })], { allowNewerAttempt: true });
    expect(useSessionsStore.getState().messages[0]).toMatchObject({ operationId: "op-2", attemptId: "at-2", attempt: 2, status: "done", text: "new" });

    state.upsertMessagesLocal([row({ operationId: "op-3", attemptId: "at-3", attempt: 1, status: "error", text: "stale" })]);
    state.upsertMessagesLocal([row({ operationId: "op-2", attemptId: "at-2", attempt: 2, status: "error", text: "downgrade" })]);
    expect(useSessionsStore.getState().messages[0]).toMatchObject({ operationId: "op-2", attemptId: "at-2", attempt: 2, status: "done", text: "new" });
  });

  it("preserves the superseded marker on a same-identity terminal update", () => {
    const terminal = row({ operationId: "op", attemptId: "at", attempt: 1, status: "stopped", superseded: true });
    useSessionsStore.setState({ messages: [terminal] });
    useSessionsStore.getState().upsertMessagesLocal([row({ operationId: "op", attemptId: "at", attempt: 1, status: "stopped", text: "late", superseded: false })]);
    expect(useSessionsStore.getState().messages[0]).toMatchObject({ text: "late", superseded: true });
  });

  it("does not let local progress upserts downgrade or replace immutable identity", () => {
    const terminal = row({ operationId: "op", attemptId: "at", attempt: 1, status: "done" });
    useSessionsStore.setState({ messages: [terminal] });
    const state = useSessionsStore.getState();
    state.upsertMessagesLocal([row({ operationId: "op", attemptId: "at", attempt: 1, status: "streaming", text: "late" })]);
    state.upsertMessagesLocal([row({ operationId: "other", attemptId: "other-at", attempt: 2, text: "forged" })]);
    const current = useSessionsStore.getState().messages[0];
    expect(current?.status).toBe("done");
    expect(current?.text).toBe("done");
    expect(current?.operationId).toBe("op");
  });
});
describe("durable deletion through the store", () => {
  it("يعيد نتيجة الحذف ويمسح المسودة بعد نجاح معاملة القاعدة", async () => {
    const id = "store-delete-ok";
    useComposerStore.getState().setDraft(id, { sharedPrompt: "مسودة" });
    useSessionsStore.setState({ sessions: [{ ...session, id, onDisk: true, onDiskDir: "folder-ok" }], currentId: id, messages: [] });
    await createSession({ ...session, id, onDisk: true, onDiskDir: "folder-ok" });

    const result = await useSessionsStore.getState().remove(id);

    expect(result.deleted).toBe(true);
    expect(result.warning).toBeUndefined();
    expect(await getSession(id)).toBeUndefined();
    expect(useComposerStore.getState().drafts[id]).toBeUndefined();
    expect(useSessionsStore.getState().sessions.some((s) => s.id === id)).toBe(false);
  });

  it("يبقي الجلسة والمسودة ظاهرتين إذا فشل الحذف الدائم", async () => {
    const id = "store-delete-fail";
    useComposerStore.getState().setDraft(id, { sharedPrompt: "مسودة ثمينة" });
    const meta = { ...session, id, onDisk: true, onDiskDir: "../escape" };
    useSessionsStore.setState({ sessions: [meta], currentId: id, messages: [] });
    await createSession(meta);

    await expect(useSessionsStore.getState().remove(id)).rejects.toThrow();

    expect(await getSession(id)).toBeDefined();
    expect(useComposerStore.getState().drafts[id]).toBeTruthy();
    expect(useSessionsStore.getState().sessions.some((s) => s.id === id)).toBe(true);
  });
});
