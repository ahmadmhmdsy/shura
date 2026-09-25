import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatScreen } from "./ChatScreen";
import { useSessionsStore } from "@/state/sessionsStore";
import { useComposerStore } from "@/state/composerStore";
import { useSettingsStore } from "@/state/settingsStore";
import { setTransportFetch } from "@/lib/transport/transport";
import { sessionOperationCoordinator } from "@/lib/chat/operationCoordinator";
import type { ChatMessage } from "@/types";
import { toast } from "sonner";
// مرجع هوية العملية: هوك hoisted حتى يصل إلى مصنع الموك قبل التحويل
const signalProbe = vi.hoisted(() => ({ calls: [] as { operationId: string; targetId: string; signal: AbortSignal | undefined }[] }));
const sendProbe = vi.hoisted(() => ({
  calls: [] as {
    operationId: string;
    sessionId: string;
    args: {
      operationId?: string;
      attemptId?: string;
      contextMode?: import("@/types").ContextMode;
      historyFor?: (targetId: string) => readonly import("@/types").ChatMessage[];
      modelInfoFor?: (targetId: string) => import("@/types").ModelInfo;
      assistantIds?: Record<string, string>;
      externalSignalFor?: (targetId: string) => AbortSignal;
    };
    cb: {
      onDelta(operationId: string, targetId: string, chunk: string, attemptId: string, turnId?: string, messageId?: string): void;
      onStatus(operationId: string, targetId: string, status: "streaming" | "done" | "error" | "stopped", error: string | undefined, attemptId: string, turnId?: string, messageId?: string): void;
      onDropped(operationId: string, targetIds: string[], attemptId: string, turnId?: string): void;
      onWarning?(message: string): void;
      onAppended(msg: unknown): void;
    };
    resolve: () => void;
  }[],
}));
vi.mock("@/lib/chat/chatController", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat/chatController")>();
  return {
    ...actual,
    sendTurn: (args: unknown, cb: (typeof sendProbe.calls)[number]["cb"]) =>
      new Promise<ChatMessage[]>((resolve) => {
        const opId = (args as { operationId: string }).operationId;
        const a = args as { sessionId?: string; operationSignal?: AbortSignal; targets?: { targetId: string }[]; externalSignalFor?: (tid: string) => AbortSignal };
        const finish = (): void => resolve([]);
        sendProbe.calls.push({ operationId: opId, sessionId: a.sessionId ?? "", args: args as (typeof sendProbe.calls)[number]["args"], cb, resolve: finish });
        // محاكاة التسجيل الحقيقي: كل هدف يستلم إشارة إلغاء مسجلة في ChatScreen
        if (a.operationSignal?.aborted) finish();
        else a.operationSignal?.addEventListener("abort", finish, { once: true });
        for (const t of a.targets ?? []) { const sig = a.externalSignalFor?.(t.targetId); signalProbe.calls.push({ operationId: opId, targetId: t.targetId, signal: sig }); }
      }),
  };
});

function callWarnings(call: (typeof sendProbe.calls)[number], message: string): void {
  call.cb.onWarning?.(message);
}

let n = 0;
async function mkSession(): Promise<import("@/types").SessionMeta> {
  n += 1;
  const s: import("@/types").SessionMeta = { id: "op" + n, title: "جلسة", createdAt: Date.now(), updatedAt: Date.now(), modelIds: [], primaryTarget: null, layoutMode: "vertical", onDisk: false };
  const repos = await import("@/lib/db/repos");
  await repos.createSession(s);
  return s;
}

const ONE: import("@/types").TargetConfig[] = [{ targetId: "t1", providerId: "openrouter", modelId: "openai/gpt-4o", modelInfo: { id: "openai/gpt-4o", label: "GPT-4o" } }];

function seed(session: import("@/types").SessionMeta): void {
  useSessionsStore.setState({ sessions: [session], currentId: session.id, messages: [], loading: false });
  useSettingsStore.setState({ providerKeys: { openrouter: "k" }, timeoutMs: 5000 });
  const targets = ONE.map((t) => ({ ...t, targetId: t.targetId + "_" + session.id }));
  useComposerStore.setState({ drafts: { [session.id]: { targets, syncMode: true, sharedPrompt: "س1", customs: {}, focusTargetId: null } } });
}

// تمريرة جاهزة بمعرف هدف مطابق لأهداف المؤلف — تفعّل زر «إعادة» الذي يستدعي persistTurn.
// يبقى المرجع ثابتًا حتى تتحقق حراسة الجهاز من رفض الإعادة أثناء العملية النشطة.
function seededTurn(s: import("@/types").SessionMeta): import("@/types").ChatMessage[] {
  const turnId = `tr-${s.id}`;
  return [
    { id: "p1", sessionId: s.id, turnId, createdAt: 1, role: "user", kind: "prompt", text: "س1", promptKind: "shared", status: "done" },
    { id: "r1", sessionId: s.id, turnId, createdAt: 2, role: "assistant", kind: "result", text: "أهلاً", providerId: "openrouter", modelId: "openai/gpt-4o", modelInfo: { id: "openai/gpt-4o", label: "GPT-4o" }, targetId: "t1_" + s.id, status: "done" },
  ];
}

beforeEach(() => { setTransportFetch((() => new Promise<Response>(() => {})) as unknown as typeof fetch); });
afterEach(async () => {
  await act(async () => {
    const sessions = useSessionsStore.getState().sessions;
    const sendOperationIds = new Set(sendProbe.calls.map((call) => call.operationId));
    for (const session of sessions) sessionOperationCoordinator.cancel(session.id);
    for (const call of sendProbe.calls) call.resolve();
    // Direct coordinator fixtures do not have a ChatScreen async finalizer. Mark
    // only those exact session owners finished; real sends drain through finish().
    for (const session of sessions) {
      for (const operationId of sessionOperationCoordinator.pendingOperationIds(session.id)) {
        if (!sendOperationIds.has(operationId)) {
          sessionOperationCoordinator.finish(operationId, session.id);
        }
      }
    }
    await sessionOperationCoordinator.waitForIdle();
  });
  sendProbe.calls.length = 0;
  signalProbe.calls.length = 0;
});

describe("ChatScreen — هوية العملية (مراجعة المهمة 3)", () => {
  it("يعمل فورًا على جلسة جديدة بلا مسودة محفوظة دون حلقة snapshot", async () => {
    const s = await mkSession();
    useSessionsStore.setState({ sessions: [s], currentId: s.id, messages: [], loading: false });
    useSettingsStore.setState({ providerKeys: { openrouter: "k" }, timeoutMs: 5000 });
    useComposerStore.setState({ drafts: {} });

    render(<ChatScreen session={s} />);

    expect(await screen.findByRole("button", { name: /إرسال/ })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("اكتب سؤالك الموحد للجميع…")).toBeInTheDocument();
  });

  it("يرفض إعادة المحاولة أثناء عملية نشطة دون بدء send ثانٍ", async () => {
    const s = await mkSession();
    seed(s);
    useSessionsStore.setState({ messages: seededTurn(s) });
    render(<ChatScreen session={s} />);

    fireEvent.click(screen.getByRole("button", { name: /إرسال/ }));
    await waitFor(() => expect(sendProbe.calls).toHaveLength(1));

    const retry = screen.getByLabelText("إعادة");
    expect(retry).toBeDisabled();
    fireEvent.click(retry);
    expect(sendProbe.calls).toHaveLength(1);

    await act(async () => { sendProbe.calls[0].resolve(); await Promise.resolve(); });
    await waitFor(() => expect(sessionOperationCoordinator.activeOperationIds()).toHaveLength(0));
  }, 8000);

  it("توصيل هوية العملية: النداءات تحمل operationId نفسه، وردّ بمعرف مغاير يُرفض حتى وإن كانت العملية حية", async () => {
    const s = await mkSession();
    seed(s);
    useSessionsStore.setState({ messages: seededTurn(s) });
    render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByLabelText("إعادة"));
    await waitFor(() => expect(sendProbe.calls.length).toBe(1));
    const call = sendProbe.calls[0];
    // هوية صريحة من ChatScreen إلى المتحكم إلى النداءات: نص غير فارغ
    expect(typeof call.operationId).toBe("string");
    expect(call.operationId.length).toBeGreaterThan(0);
    // وضع السياق الافتراضي stateful يمر صريحًا مع النداء
    expect(call.args.contextMode).toBe("stateful");
    const info = call.args.modelInfoFor?.("t1_" + s.id);
    expect(info?.id).toBe("openai/gpt-4o");
    const history = call.args.historyFor?.("t1_" + s.id);
    expect(history?.some((m) => m.id === "r1")).toBe(true);
    // دلتا بحمل نفس operationId تُطبَّق
    const attemptId = call.args.attemptId!;
    // The real controller persists the canonical attempt before callbacks; mirror that
    // prerequisite in this controller-level callback seam.
    await act(async () => {
      useSessionsStore.setState((state) => ({
        messages: state.messages.map((message) => message.id === "r1"
          ? { ...message, operationId: call.operationId, attemptId, attempt: 1, status: "streaming" }
          : message),
      }));
      call.cb.onDelta(call.operationId, "t1_" + s.id, "ملحق", attemptId, "tr-" + s.id, "r1");
      // A wrong operation, attempt, turn, or message identity is rejected while the operation is live.
      call.cb.onDelta("op-مغاير-كليا", "t1_" + s.id, "همس متسلل", attemptId, "tr-" + s.id, "r1");
      call.cb.onDelta(call.operationId, "t1_" + s.id, "همس محاولة", "at-wrong", "tr-" + s.id, "r1");
      call.cb.onDelta(call.operationId, "t1_" + s.id, "همس turno", attemptId, "tr-other", "r1");
      call.cb.onDelta(call.operationId, "t1_" + s.id, "همس رسالة", attemptId, "tr-" + s.id, "m-other");
      await Promise.resolve();
    });
    expect(useSessionsStore.getState().messages.find((m) => m.id === "r1")?.text).toBe("أهلاًملحق");
    call.resolve();
    await waitFor(() => expect(screen.getByRole("button", { name: /إرسال/ })).not.toBeDisabled());
  }, 8000);

  it("يرفض callback هدف/دور غير مطابق ولا يطلق toast", async () => {
    const s = await mkSession();
    seed(s);
    useSessionsStore.setState({ messages: seededTurn(s) });
    render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByLabelText("إعادة"));
    await waitFor(() => expect(sendProbe.calls).toHaveLength(1));
    const call = sendProbe.calls[0];
    const attemptId = call.args.attemptId!;
    const turnId = "tr-" + s.id;
    const base = useSessionsStore.getState().messages.find((message) => message.id === "r1")!;
    const identified = { ...base, operationId: call.operationId, attemptId, attempt: 1, status: "streaming" as const };
    const errorToast = vi.spyOn(toast, "error").mockImplementation(() => "");
    try {
      act(() => {
        call.cb.onStatus(call.operationId, "wrong-target", "error", "wrong", attemptId, turnId, "r1");
        expect(errorToast).not.toHaveBeenCalled();
        const forgedTarget = { ...identified, text: "forged-target", targetId: "wrong-target" };
        call.cb.onAppended(forgedTarget);
        expect(sessionOperationCoordinator.progressFor(s.id)).toHaveLength(0);
        const forgedRole = { ...identified, text: "forged-role", role: "user" as const, kind: "prompt" as const };
        call.cb.onAppended(forgedRole);
        expect(sessionOperationCoordinator.progressFor(s.id)).toHaveLength(0);
        const forgedId = { ...identified, id: "forged-message-id", text: "forged-id" };
        call.cb.onAppended(forgedId);
        expect(sessionOperationCoordinator.progressFor(s.id)).toHaveLength(0);
        const valid = { ...identified, text: "positive", status: "done" as const };
        call.cb.onAppended(valid);
      });
      expect(sessionOperationCoordinator.progressFor(s.id)).toHaveLength(1);
      expect(useSessionsStore.getState().messages.find((message) => message.id === "r1")?.text).toBe("positive");
    } finally {
      errorToast.mockRestore();
    }
  });

  it("يعكس حالة المنسق بعد إعادة تركيب الشاشة", async () => {
    const s = await mkSession();
    seed(s);
    useSessionsStore.setState({ messages: seededTurn(s) });
    const firstView = render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByRole("button", { name: /إرسال/ }));
    await waitFor(() => expect(sendProbe.calls).toHaveLength(1));

    firstView.unmount();
    render(<ChatScreen session={s} />);
    expect(screen.getByLabelText("إعادة")).toBeDisabled();
    expect(screen.getByRole("button", { name: /استخرج خلاصة/ })).toBeDisabled();
    act(() => sessionOperationCoordinator.cancel(s.id));
  });

  it("يعيد hydrate صف عملية حديثة عندما يعيد remount فتح الجلسة قبل تحميل الرسائل", async () => {
    const s = await mkSession();
    seed(s);
    const handle = sessionOperationCoordinator.start(s.id, "send", new AbortController())!;
    const base: ChatMessage = {
      id: "remount-empty-result", sessionId: s.id, turnId: "tr-remount-empty", createdAt: 1,
      role: "assistant", kind: "result", providerId: "openrouter", modelId: "openai/gpt-4o",
      modelInfo: { id: "openai/gpt-4o", label: "GPT-4o" }, targetId: "t1_" + s.id,
      text: "مبدئي", status: "streaming", operationId: handle.id, attemptId: "at-remount-empty", attempt: 1,
    };
    await act(async () => {
      expect(sessionOperationCoordinator.publishProgress({
        sessionId: s.id, operationId: handle.id, attemptId: base.attemptId!, turnId: base.turnId,
        messageId: base.id, targetId: base.targetId!, text: "تم التحميل", status: "streaming",
        message: { ...base, text: "تم التحميل", status: "streaming" },
      })).toBe(true);
      await Promise.resolve();
    });
    expect(useSessionsStore.getState().messages).toHaveLength(0);
    render(<ChatScreen session={s} />);
    await waitFor(() => expect(useSessionsStore.getState().messages.find((message) => message.id === base.id)).toMatchObject({ text: "تم التحميل", status: "streaming" }));
    await act(async () => { sessionOperationCoordinator.finish(handle.id, s.id); await Promise.resolve(); });
  }, 8000);

  it("تطبّق callbacks法則 القديمة بعد remount قبل اكتمال hydration ثم ينتظر الصف الدائم", async () => {
    const s = await mkSession();
    seed(s);
    useSessionsStore.setState({ messages: seededTurn(s) });
    const firstView = render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByLabelText("إعادة"));
    await waitFor(() => expect(sendProbe.calls).toHaveLength(1));
    const call = sendProbe.calls[0]!;
    const attemptId = call.args.attemptId!;
    const base = useSessionsStore.getState().messages.find((message) => message.id === "r1")!;
    const identified: ChatMessage = {
      ...base,
      text: "أهلاً",
      status: "streaming",
      operationId: call.operationId,
      attemptId,
      attempt: 1,
    };

    firstView.unmount();
    await act(async () => {
      useSessionsStore.setState({ currentId: s.id, messages: [], loading: true });
      await Promise.resolve();
    });
    render(<ChatScreen session={s} />);
    await act(async () => {
      call.cb.onAppended(identified);
      call.cb.onDelta(call.operationId, identified.targetId!, "بعد", attemptId, identified.turnId, identified.id);
      call.cb.onStatus(call.operationId, identified.targetId!, "done", undefined, attemptId, identified.turnId, identified.id);
      useSessionsStore.setState({ messages: [identified], loading: false });
      await Promise.resolve();
    });

    await waitFor(() => expect(useSessionsStore.getState().messages.find((message) => message.id === "r1")).toMatchObject({
      text: "أهلاًبعد",
      status: "done",
      attemptId,
    }));
  }, 8000);

  it("يعيد بناء طبقة delta/final على remount من progress العملية نفسها", async () => {
    const s = await mkSession();
    seed(s);
    const initial = seededTurn(s);
    let handle!: NonNullable<ReturnType<typeof sessionOperationCoordinator.start>>;
    await act(async () => {
      handle = sessionOperationCoordinator.start(s.id, "send", new AbortController())!;
      useSessionsStore.setState({ messages: initial.map((message) => message.id === "r1" ? {
        ...message,
        operationId: handle.id,
        attemptId: "at-remount",
        attempt: 1,
        status: "streaming",
      } : message) });
    });
    const first = render(<ChatScreen session={s} />);
    first.unmount();
    render(<ChatScreen session={s} />);
    const activeId = handle.id;
    const base = useSessionsStore.getState().messages.find((message) => message.id === "r1")!;
    await act(async () => {
      expect(sessionOperationCoordinator.publishProgress({
        sessionId: s.id, operationId: activeId, attemptId: "at-remount", turnId: base.turnId,
        messageId: base.id, targetId: base.targetId!, text: "جزئي بعد remount", status: "streaming", message: { ...base, text: "جزئي بعد remount", status: "streaming" },
      })).toBe(true);
      await Promise.resolve();
    });
    await waitFor(() => expect(useSessionsStore.getState().messages.find((message) => message.id === "r1")?.text).toBe("جزئي بعد remount"));
    await act(async () => {
      expect(sessionOperationCoordinator.publishProgress({
        sessionId: s.id, operationId: activeId, attemptId: "at-remount", turnId: base.turnId,
        messageId: base.id, targetId: base.targetId!, text: "نهائي بعد remount", status: "done", message: { ...base, text: "نهائي بعد remount", status: "done" },
      })).toBe(true);
      await Promise.resolve();
    });
    await waitFor(() => expect(useSessionsStore.getState().messages.find((message) => message.id === "r1")).toMatchObject({ text: "نهائي بعد remount", status: "done" }));
    await act(async () => { sessionOperationCoordinator.finish(activeId); await Promise.resolve(); });
  }, 8000);

  it("لا يطبّق progress remount إذا اختلف الهدف أو رقم المحاولة", async () => {
    const s = await mkSession();
    seed(s);
    const handle = sessionOperationCoordinator.start(s.id, "send", new AbortController())!;
    const base: ChatMessage = { id: "progress-identity-row", sessionId: s.id, turnId: "tr-progress-identity", createdAt: 1, role: "assistant", kind: "result", providerId: "openrouter", modelId: "openai/gpt-4o", modelInfo: { id: "openai/gpt-4o", label: "GPT-4o" }, targetId: "t1_" + s.id, text: "original", status: "streaming", operationId: handle.id, attemptId: "at-progress-identity", attempt: 1 };
    await act(async () => {
      useSessionsStore.setState({ messages: [base] });
      await Promise.resolve();
    });
    const upsert = vi.spyOn(useSessionsStore.getState(), "upsertMessagesLocal");
    render(<ChatScreen session={s} />);
    upsert.mockClear();
    await act(async () => {
      expect(sessionOperationCoordinator.publishProgress({ sessionId: s.id, operationId: handle.id, attemptId: base.attemptId!, turnId: base.turnId, messageId: base.id, targetId: "forged-target", text: "forged", status: "streaming", message: { ...base, targetId: "forged-target", text: "forged" } })).toBe(true);
      await Promise.resolve();
    });
    expect(upsert).not.toHaveBeenCalled();
    upsert.mockRestore();
  });

  it("يعيد تطبيق تقدم العملية بعد إكمال فتح الجلسة وتحميل صفها", async () => {
    const s = await mkSession();
    seed(s);
    const handle = sessionOperationCoordinator.start(s.id, "send", new AbortController())!;
    const base: ChatMessage = {
      id: "rehydrated-result", sessionId: s.id, turnId: "tr-rehydrate", createdAt: 1,
      role: "assistant", kind: "result", text: "قبل", providerId: "openrouter", modelId: "openai/gpt-4o",
      modelInfo: { id: "openai/gpt-4o", label: "GPT-4o" }, targetId: "t1_" + s.id, status: "streaming",
      operationId: handle.id, attemptId: "at-rehydrate", attempt: 1,
    };
    useSessionsStore.setState({ loading: true });
    render(<ChatScreen session={s} />);
    await act(async () => {
      expect(sessionOperationCoordinator.publishProgress({
        sessionId: s.id, operationId: handle.id, attemptId: base.attemptId!, turnId: base.turnId,
        messageId: base.id, targetId: base.targetId!, text: "بعد التحميل", status: "streaming", message: { ...base, text: "بعد التحميل" },
      })).toBe(true);
      await Promise.resolve();
    });
    expect(useSessionsStore.getState().messages).toHaveLength(0);
    await act(async () => {
      useSessionsStore.setState({ messages: [base], loading: false });
      await Promise.resolve();
    });
    await waitFor(() => expect(useSessionsStore.getState().messages[0]?.text).toBe("بعد التحميل"));
    await act(async () => { sessionOperationCoordinator.finish(handle.id); await Promise.resolve(); });
  }, 8000);

  it("يمكّن Stop بعد remount من إيقاف الصف الحالي بهويته الكاملة", async () => {
    const s = await mkSession();
    seed(s);
    const initial = seededTurn(s);
    let handle!: NonNullable<ReturnType<typeof sessionOperationCoordinator.start>>;
    await act(async () => {
      handle = sessionOperationCoordinator.start(s.id, "send", new AbortController())!;
      useSessionsStore.setState({ messages: initial.map((message) => message.id === "r1" ? {
        ...message, operationId: handle.id, attemptId: "at-stop-remount", attempt: 1, status: "streaming",
      } : message) });
    });
    const first = render(<ChatScreen session={s} />);
    first.unmount();
    render(<ChatScreen session={s} />);
    const stops = screen.getAllByRole("button", { name: /إيقاف/ });
    fireEvent.click(stops[stops.length - 1]);
    await waitFor(() => expect(sessionOperationCoordinator.activeOperationIds()).toHaveLength(0));
    expect(useSessionsStore.getState().messages.find((message) => message.id === "r1")?.status).toBe("stopped");
  }, 8000);

  it("يبقي زر الإيقاف الخاص بالبطاقة فعالًا أثناء عملية نشطة", async () => {
    const s = await mkSession();
    seed(s);
    const handle = sessionOperationCoordinator.start(s.id, "send", new AbortController())!;
    const base = seededTurn(s).find((message) => message.id === "r1")!;
    await act(async () => {
      useSessionsStore.setState({ messages: [{ ...base, operationId: handle.id, attemptId: "at-card-stop", attempt: 1, status: "streaming" }] });
      await Promise.resolve();
    });
    render(<ChatScreen session={s} />);
    const cardStop = screen.getAllByRole("button", { name: /إيقاف/ })[0];
    expect(cardStop).not.toBeDisabled();
    fireEvent.click(cardStop);
    await waitFor(() => expect(sessionOperationCoordinator.activeOperationIds()).toHaveLength(0));
    expect(useSessionsStore.getState().messages.find((message) => message.id === "r1")?.status).toBe("stopped");
  }, 8000);

  it("يعطّل Stop على بطاقة stale ولا يلغي العملية الحالية", async () => {
    const s = await mkSession();
    seed(s);
    const handle = sessionOperationCoordinator.start(s.id, "send", new AbortController())!;
    const base = seededTurn(s).find((message) => message.id === "r1")!;
    const stale = { ...base, id: "r-stale", operationId: "op-old", attemptId: "at-old", attempt: 1, status: "streaming" as const };
    const live = { ...base, id: "r-live", operationId: handle.id, attemptId: "at-live", attempt: 1, status: "streaming" as const };
    await act(async () => {
      useSessionsStore.setState({ messages: [...seededTurn(s).filter((message) => message.role === "user"), stale, live] });
      await Promise.resolve();
    });
    render(<ChatScreen session={s} />);
    const stops = screen.getAllByRole("button", { name: /إيقاف/ });
    expect(stops).toHaveLength(3);
    expect(stops[0]).toBeDisabled();
    fireEvent.click(stops[0]);
    expect(handle.controller.signal.aborted).toBe(false);
  });

  it("يميّز صفّين في تمرّتين على الهدف نفسه ولا يوقف غير المطابق", async () => {
    const s = await mkSession();
    seed(s);
    const handle = sessionOperationCoordinator.start(s.id, "send", new AbortController())!;
    const base = seededTurn(s).find((message) => message.id === "r1")!;
    const stale = { ...base, id: "r-same-target-old", turnId: "tr-old", operationId: "op-old", attemptId: "at-old", attempt: 1, status: "streaming" as const };
    const live = { ...base, id: "r-same-target-live", turnId: "tr-live", operationId: handle.id, attemptId: "at-live", attempt: 1, status: "streaming" as const };
    await act(async () => {
      useSessionsStore.setState({ messages: [...seededTurn(s).filter((message) => message.role === "user"), stale, live] });
      await Promise.resolve();
    });
    render(<ChatScreen session={s} />);
    const stops = screen.getAllByRole("button", { name: /إيقاف/ });
    expect(stops.filter((button) => button.hasAttribute("disabled"))).toHaveLength(1);
    const enabledStop = stops.find((button) => !button.hasAttribute("disabled"))!;
    fireEvent.click(enabledStop);
    await waitFor(() => expect(sessionOperationCoordinator.activeOperationIds()).toHaveLength(0));
    expect(useSessionsStore.getState().messages.find((message) => message.id === stale.id)?.status).toBe("streaming");
    expect(useSessionsStore.getState().messages.find((message) => message.id === live.id)?.status).toBe("stopped");
  }, 8000);

  it("يحتفظ بنفس الإشارة الخارجية بعد الإلغاء الفوري", async () => {
    const s = await mkSession();
    seed(s);
    useSessionsStore.setState({ messages: seededTurn(s) });
    render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByRole("button", { name: /إرسال/ }));
    await waitFor(() => expect(sendProbe.calls).toHaveLength(1));
    const call = sendProbe.calls[0];
    const targetId = "t1_" + s.id;
    const first = signalProbe.calls.find((entry) => entry.operationId === call.operationId && entry.targetId === targetId)?.signal;
    expect(first).toBeDefined();
    await act(async () => {
      sessionOperationCoordinator.cancel(s.id);
      await Promise.resolve();
    });
    const second = call.args.externalSignalFor?.(targetId);
    expect(second).toBe(first);
    expect(first?.aborted).toBe(true);
  }, 8000);

  it("يسمح Stop من الحالة الفارغة عندما يكون Coordinator نشطًا", async () => {
    const s = await mkSession();
    seed(s);
    const handle = sessionOperationCoordinator.start(s.id, "send", new AbortController())!;
    render(<ChatScreen session={s} />);
    const stop = screen.getByRole("button", { name: /إيقاف/ });
    expect(stop).not.toBeDisabled();
    fireEvent.click(stop);
    await waitFor(() => expect(sessionOperationCoordinator.activeOperationIds()).toHaveLength(0));
    expect(handle.controller.signal.aborted).toBe(true);
  }, 8000);

  it("لا يجمع أو يعرض رسائل جلسة أخرى أثناء رسم الجلسة الحالية", async () => {
    const current = await mkSession();
    const other = { ...current, id: "other-session", title: "أخرى" };
    seed(current);
    useSessionsStore.setState({
      sessions: [current, other],
      currentId: current.id,
      messages: [...seededTurn(current), { ...seededTurn(current)[1]!, id: "foreign-result", sessionId: other.id, turnId: "foreign-turn", text: "LEAK" }],
    });
    render(<ChatScreen session={current} />);
    expect(screen.queryByText("LEAK")).not.toBeInTheDocument();
  });

  it("لا يعرض warning عملية قديمة بعد انتقال العرض إلى جلسة أخرى", async () => {
    const first = await mkSession();
    seed(first);
    useSessionsStore.setState({ messages: seededTurn(first) });
    const warningSpy = vi.spyOn(toast, "warning");
    render(<ChatScreen session={first} />);
    fireEvent.click(screen.getByLabelText("إعادة"));
    await waitFor(() => expect(sendProbe.calls).toHaveLength(1));
    const second = await mkSession();
    await act(async () => {
      useSessionsStore.setState((state) => ({ sessions: [...state.sessions, second], currentId: second.id }));
      callWarnings(sendProbe.calls[0], "تحذير قديم");
      await Promise.resolve();
    });
    expect(warningSpy).not.toHaveBeenCalledWith("تحذير قديم");
    warningSpy.mockRestore();
  });

  it("يعرض warning العملية القديمة بعد remount لنفس الجلسة ما دامت latest", async () => {
    const s = await mkSession();
    seed(s);
    useSessionsStore.setState({ messages: seededTurn(s) });
    const warningSpy = vi.spyOn(toast, "warning");
    const firstView = render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByLabelText("إعادة"));
    await waitFor(() => expect(sendProbe.calls).toHaveLength(1));
    const call = sendProbe.calls[0];
    firstView.unmount();
    render(<ChatScreen session={s} />);
    await act(async () => {
      callWarnings(call, "تحذير remount");
      await Promise.resolve();
    });
    expect(warningSpy).toHaveBeenCalledWith("تحذير remount");
    warningSpy.mockRestore();
  });

  it("يخفي warning العملية القديمة بعد بدء عملية بديلة في نفس الجلسة", async () => {
    const s = await mkSession();
    seed(s);
    useSessionsStore.setState({ messages: seededTurn(s) });
    const warningSpy = vi.spyOn(toast, "warning");
    render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByLabelText("إعادة"));
    await waitFor(() => expect(sendProbe.calls).toHaveLength(1));
    const call = sendProbe.calls[0];
    await act(async () => {
      sessionOperationCoordinator.cancel(s.id);
      expect(sessionOperationCoordinator.start(s.id, "send", new AbortController())).toBeTruthy();
      callWarnings(call, "تحذير بديل");
      await Promise.resolve();
    });
    expect(warningSpy).not.toHaveBeenCalledWith("تحذير بديل");
    warningSpy.mockRestore();
  });

  it("لا يبدأ send أو signal ثانٍ عند إعادة محاولة أثناء العملية النشطة", async () => {
    const s = await mkSession();
    seed(s);
    useSessionsStore.setState({ messages: seededTurn(s) });
    render(<ChatScreen session={s} />);

    fireEvent.click(screen.getByRole("button", { name: /إرسال/ }));
    await waitFor(() => expect(sendProbe.calls).toHaveLength(1));

    const operationId = sendProbe.calls[0].operationId;
    const tid = "t1_" + s.id;
    const activeSignal = signalProbe.calls.find((call) => call.operationId === operationId && call.targetId === tid);
    expect(activeSignal?.signal).toBeDefined();

    const retry = screen.getByLabelText("إعادة");
    expect(retry).toBeDisabled();
    fireEvent.click(retry);
    expect(sendProbe.calls).toHaveLength(1);
    expect(signalProbe.calls.filter((call) => call.operationId === operationId && call.targetId === tid)).toHaveLength(1);

    await act(async () => { sendProbe.calls[0].resolve(); await Promise.resolve(); });
    await waitFor(() => expect(sessionOperationCoordinator.activeOperationIds()).toHaveLength(0));
  }, 8000);
});
