import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatScreen } from "./ChatScreen";
import { useSessionsStore } from "@/state/sessionsStore";
import { useComposerStore } from "@/state/composerStore";
import { useSettingsStore } from "@/state/settingsStore";
import { setTransportFetch } from "@/lib/transport/transport";
import { toast } from "sonner";
import { sseMockFetch, sseResponse } from "@/test/mocks/sse";
import { createSession, getMessages, getSession } from "@/lib/db/repos";
import { memoryFileSink, setFileSink, type FileSink } from "@/lib/markdown/sink";
import type { TargetConfig, ChatMessage, SessionMeta } from "@/types";

// خطاف أخطاء داخلية معتمد للاختبارات: appendMessage الحقيقي يمرّ عبره دائمًا،
// ويمكن للاختبار أن يجعل النداء رقم N يفشل لمحاكاة خطأ طبقة تخزين داخلية.
const reposHook = vi.hoisted(() => ({
  appendCalls: 0,
  streamingCalls: 0,
  failOnCall: 0,
  holdOnCall: 0,
  holdGate: null as Promise<void> | null,
  holdFinalSummary: false,
  failFinalSummary: false,
  onHoldStart: null as (() => void) | null,
}));
vi.mock("@/lib/db/repos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/repos")>();
  const realAppend = actual.appendMessage;
  return {
    ...actual,
    appendMessage: async (msg: ChatMessage) => {
      reposHook.appendCalls += 1;
      if (msg.status === "streaming") reposHook.streamingCalls += 1;
      const holdFinalSummary = reposHook.holdFinalSummary && msg.kind === "synthesis" && msg.status !== "streaming";
      if (reposHook.holdOnCall > 0 && reposHook.appendCalls === reposHook.holdOnCall && reposHook.holdGate) {
        reposHook.onHoldStart?.();
        await reposHook.holdGate;
      } else if (holdFinalSummary && reposHook.holdGate) {
        reposHook.holdFinalSummary = false;
        reposHook.onHoldStart?.();
        await reposHook.holdGate;
      }
      const failFinalSummary = reposHook.failFinalSummary && msg.kind === "synthesis" && msg.status !== "streaming";
      if (failFinalSummary) reposHook.failFinalSummary = false;
      if ((reposHook.failOnCall > 0 && reposHook.appendCalls === reposHook.failOnCall) || failFinalSummary) throw new Error("فشل تخزين داخلي");
      return realAppend(msg);
    },
  };
});

const summaryDispatchHook = vi.hoisted(() => ({
  forceStatus: null as "done" | "stopped" | "error" | null,
  forceError: undefined as string | undefined,
}));
vi.mock("@/lib/chat/dispatch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat/dispatch")>();
  return {
    ...actual,
    dispatchTurn: async (args: Parameters<typeof actual.dispatchTurn>[0]) => {
      const outcomes = await actual.dispatchTurn(args);
      if (summaryDispatchHook.forceStatus === null) return outcomes;
      const [head, ...tail] = outcomes;
      if (!head) return outcomes;
      return [{
        ...head,
        status: summaryDispatchHook.forceStatus,
        ...(summaryDispatchHook.forceError === undefined ? {} : { error: summaryDispatchHook.forceError }),
      }, ...tail];
    },
  };
});

let n = 0;
async function mkSession(over: Partial<SessionMeta> = {}): Promise<SessionMeta> {
  n += 1;
  const s: SessionMeta = { id: "cs" + n, title: "جلسة", createdAt: Date.now(), updatedAt: Date.now(), modelIds: [], primaryTarget: null, layoutMode: "vertical", onDisk: false, ...over };
  await createSession(s);
  return s;
}

const TWO: TargetConfig[] = [
  { targetId: "t1", providerId: "openrouter", modelId: "openai/gpt-4o", modelInfo: { id: "openai/gpt-4o", label: "GPT-4o" } },
  { targetId: "t2", providerId: "minimax", modelId: "MiniMax-M2", modelInfo: { id: "MiniMax-M2", label: "MiniMax M2" } },
];
const ONE: TargetConfig[] = [{ targetId: "t1", providerId: "openrouter", modelId: "openai/gpt-4o", modelInfo: { id: "openai/gpt-4o", label: "GPT-4o" } }];

function seed(session: SessionMeta, opts: { targets?: TargetConfig[]; prompt?: string } = {}): void {
  useSessionsStore.setState({ sessions: [session], currentId: session.id, messages: [] });
  useSettingsStore.setState({ providerKeys: { openrouter: "k", minimax: "k" }, timeoutMs: 5000 });
  // معرفات أهداف فريدة لكل اختبار: عمليات إرسال سابقة معلقة (مؤقتات مهلة) قد تكمل بعد انتهاء
  // اختبارها وتكتب في المخزن العام — التفرد يمنع التطابق الخاطئ في مسار الدلتا الاحتياطي.
  const targets = (opts.targets ?? TWO).map((t) => ({ ...t, targetId: t.targetId + "_" + session.id }));
  useComposerStore.setState({ drafts: { [session.id]: { targets, syncMode: true, sharedPrompt: opts.prompt ?? "س1", customs: {}, focusTargetId: null } } });
}

function doneTurn(session: SessionMeta): ChatMessage[] {
  return [
    { id: "m1", sessionId: session.id, turnId: "tr1", createdAt: 1, role: "user", kind: "prompt", text: "س1", promptKind: "shared", status: "done" },
    { id: "m2", sessionId: session.id, turnId: "tr1", createdAt: 2, role: "assistant", kind: "result", text: "جواب", providerId: "openrouter", modelId: "openai/gpt-4o", targetId: "t1", status: "done" },
    { id: "m3", sessionId: session.id, turnId: "tr1", createdAt: 3, role: "assistant", kind: "result", text: "جواب", providerId: "minimax", modelId: "MiniMax-M2", targetId: "t2", status: "done" },
  ];
}

const realPatchMessage = useSessionsStore.getState().patchMessage;

beforeEach(() => {
  // A thrown patch mock can be copied into a later Zustand state object; restore the real
  // observer before each test so the persistence regressions do not leak across cases.
  useSessionsStore.setState({ patchMessage: realPatchMessage });
  // Reset the module-global sink between tests without changing production APIs.
  setFileSink(null as unknown as FileSink);
  setTransportFetch(sseMockFetch());
  reposHook.appendCalls = 0;
  reposHook.streamingCalls = 0;
  reposHook.failOnCall = 0;
  reposHook.holdOnCall = 0;
  reposHook.holdGate = null;
  reposHook.holdFinalSummary = false;
  reposHook.failFinalSummary = false;
  reposHook.onHoldStart = null;
  summaryDispatchHook.forceStatus = null;
  summaryDispatchHook.forceError = undefined;
});

afterEach(() => {
  setFileSink(null as unknown as FileSink);
  vi.restoreAllMocks();
});

describe("ChatScreen — التوصيل الحي", () => {
  it("الإرسال يبث حيًا: السؤال يظهر وبطاقتان بالنص النهائي", async () => {
    const s = await mkSession();
    seed(s);
    render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByRole("button", { name: /إرسال/ }));
    expect(await screen.findAllByText("أهلاً", {}, { timeout: 3000 })).toHaveLength(2);
    // «س1» يظهر في الاقتباس وفي قيمة الـ textarea (React يعرض القيمة كمحتوى) — نكفي بوجوده
    expect(screen.getAllByText("س1").length).toBeGreaterThan(0);
  });

  it("التبديل عمودي/أفقي يُحفظ في Dexie ومخزن الجلسات", async () => {
    const s = await mkSession();
    seed(s);
    useSessionsStore.setState({ messages: doneTurn(s) });
    render(<ChatScreen session={s} />);
    expect(screen.getByRole("button", { name: /أفقي/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /أفقي/ }));
    await waitFor(() => expect(useSessionsStore.getState().sessions.find((x) => x.id === s.id)?.layoutMode).toBe("horizontal"));
    expect((await getSession(s.id))?.layoutMode).toBe("horizontal");
  });

  it("الإيقاف أثناء البث يجعل البطاقتين «أُوقف» لا «خطأ»", async () => {
    let hangCalls = 0;
    const hangFetch = ((...a: unknown[]) => { void a; hangCalls += 1; return new Promise<Response>(() => {}); }) as unknown as typeof fetch;
    setTransportFetch(hangFetch);
    const s = await mkSession();
    seed(s);
    render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByRole("button", { name: /إرسال/ }));
    await waitFor(() => expect(hangCalls).toBe(2));
    // البطاقتان أثناء البث تضيفان زرّي إيقاف (aria-label «إيقاف») — زر الإيقاف العام هو الأخير في DOM
    const stops = screen.getAllByRole("button", { name: /إيقاف/ });
    fireEvent.click(stops[stops.length - 1]);
    // تسوية بمؤقت حقيقي: تحديثات المخزن خارج act تُسقَف حتى مؤقت حقيقي يفرغها —
    // استعلام RTL المعتمد على act وحده قد يفوّتها في بيئة عمال متوازية.
    await new Promise((r) => setTimeout(r, 800));
    expect(await screen.findAllByText("أُوقف", {}, { timeout: 3000 })).toHaveLength(2);
  });

  it("إعادة المحاولة تستبدل البطاقة الفاشلة بلا تكرار", async () => {
    const f = sseMockFetch();
    setTransportFetch(((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes("openrouter") ? new Response("{}", { status: 401 }) : f(input, init)) as typeof fetch);
    const s = await mkSession();
    seed(s, { targets: ONE });
    render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByRole("button", { name: /إرسال/ }));
    // مهلة أوسع من الافتراضية: تحت توازي عمال vitest قد يتأخر استقرار تدفق 401 عن ثانية
    await screen.findByText(/مفتاح غير صالح/, {}, { timeout: 3000 });
    setTransportFetch(sseMockFetch());
    fireEvent.click(screen.getByLabelText("إعادة"));
    expect(await screen.findAllByText("أهلاً", {}, { timeout: 3000 })).toHaveLength(1);
    const rows = await getMessages(s.id);
    expect(rows.filter((m) => m.role === "assistant")).toHaveLength(1);
  });

  it("مع مُنشّط ملفات: أول إرسال يملأ onDiskDir ويكتب الجلسة على القرص", async () => {
    const sink = memoryFileSink();
    setFileSink(sink);
    const s = await mkSession();
    seed(s);
    render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByRole("button", { name: /إرسال/ }));
    expect(await screen.findAllByText("أهلاً", {}, { timeout: 3000 })).toHaveLength(2);
    const meta = await getSession(s.id);
    expect(meta?.onDiskDir).toBeTruthy();
    const dir = "sessions/" + meta?.onDiskDir;
    expect(await sink.exists(dir + "/meta.json")).toBe(true);
    // session.md تُكتب بعد استقرار النتائج مباشرة — ننتظرها بدل سباق مع حلقة النتائج
    await waitFor(async () => expect(await sink.exists(dir + "/session.md")).toBe(true), { timeout: 3000 });
    expect(await sink.readFile(dir + "/session.md")).toContain("أهلاً");
  });

  it("الخلاصة تثبت صفها في Dexie عند الاكتمال: إعادة التحميل تعرض النص لا بثًا معلقًا", async () => {
    const s = await mkSession();
    seed(s);
    // تمرّة مكتملة حتى يمر حارس «لا نتائج لاستخلاصها بعد» ويُشتق النموذج الأساسي من targets[0]
    useSessionsStore.setState({ messages: doneTurn(s) });
    render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
    expect(await screen.findByText("خلاصة النموذج الأساسي")).toBeInTheDocument();
    // إعادة التحميل من Dexie بعد الاكتمال: صف الخلاصة بنصه النهائي وحالته done (لا فارغ/streaming)
    await waitFor(async () => {
      const rows = await getMessages(s.id);
      const synth = rows.find((m) => m.kind === "synthesis");
      expect(synth?.text).toBe("أهلاً");
      expect(synth?.status).toBe("done");
    }, { timeout: 3000 });
    useSessionsStore.setState({ messages: await getMessages(s.id) });
    const assistants = (await getMessages(s.id)).filter((m) => m.role === "assistant");
    const last = assistants[assistants.length - 1];
    expect(last.kind).toBe("synthesis");
    expect(last.text.length).toBeGreaterThan(0);
    expect(last.status).toBe("done");
  });

  // تمريرة مصدر بمعرف هدف مطابق لأهداف المؤلف (بلا لاحقة seed): شرط عمل الإعادة فعليًا
  function seededTurn(s: SessionMeta): ChatMessage[] {
    return [
      { id: "p1", sessionId: s.id, turnId: "tr1", createdAt: 1, role: "user", kind: "prompt", text: "س1", promptKind: "shared", status: "done" },
      { id: "r1", sessionId: s.id, turnId: "tr1", createdAt: 2, role: "assistant", kind: "result", text: "أهلاً", providerId: "openrouter", modelId: "openai/gpt-4o", targetId: "t1_" + s.id, status: "done" },
    ];
  }

  it("إعادة المحاولة تعمل بعد وجود خلاصة: تُعاد من تمريرة المصدر لا من syn- الأخيرة", async () => {
    const s = await mkSession();
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: seededTurn(s) });
    // بثّ متمايز: نداء الخلاصة يعيد «أهلاً» ونداء الإعادة يعيد «مُعاد» — الفرق يثبت أن الإعادة نُفذت
    let calls = 0;
    setTransportFetch(((...a: unknown[]) => { void a; calls += 1; return sseResponse(calls === 1 ? ["أهلاً"] : ["مُعاد"]); }) as unknown as typeof fetch);
    render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
    expect(await screen.findByText("خلاصة النموذج الأساسي")).toBeInTheDocument();
    await waitFor(async () => { const synth = (await getMessages(s.id)).find((m) => m.kind === "synthesis"); expect(synth?.status, "synthErr=" + synth?.error).toBe("done"); }, { timeout: 3000 });
    // الآن «إعادة» على بطاقة تمريرة المصدر — كانت تصمت (آخر تمريرة syn- بلا targetId)
    fireEvent.click(screen.getByLabelText("إعادة"));
    expect(await screen.findByText("مُعاد", {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it("ضغط مزدوج على الخلاصة لا يولد تمريرتي خلاصة", async () => {
    const s = await mkSession();
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: seededTurn(s) });
    render(<ChatScreen session={s} />);
    const btn = screen.getByRole("button", { name: /استخرج خلاصة/ });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(await screen.findByText("خلاصة النموذج الأساسي")).toBeInTheDocument();
    await waitFor(async () => expect((await getMessages(s.id)).find((m) => m.kind === "synthesis")?.status).toBe("done"), { timeout: 3000 });
    const rows = await getMessages(s.id);
    expect(rows.filter((m) => m.kind === "synthesis")).toHaveLength(1);
    expect(rows.filter((m) => m.role === "user" && m.text === "طلب خلاصة من النموذج الأساسي")).toHaveLength(1);
  });

  it("خطأ داخلي أثناء الخلاصة: بطاقة خطأ لا بث معلق", async () => {
    const s = await mkSession();
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: seededTurn(s) });
    // الفشل يقتصر على صف الخلاصة النهائي، لا نقطة حفظ المؤقتة.
    reposHook.failFinalSummary = true;
    render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
    expect(await screen.findByText("فشل تخزين داخلي", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText("يكتب…")).not.toBeInTheDocument();
    await waitFor(async () => expect((await getMessages(s.id)).find((m) => m.kind === "synthesis")?.status).toBe("error"), { timeout: 3000 });
  });

  it("فشل حفظ الخلاصة بعد تبديل الجلسة يثبت الخطأ النهائي في الجلسة الأصلية بهويتي المحاولة والعملية", async () => {
    let release!: () => void;
    const holdGate = new Promise<void>((resolve) => { release = resolve; });
    let held!: () => void;
    const heldPromise = new Promise<void>((resolve) => { held = resolve; });
    reposHook.holdFinalSummary = true;
    reposHook.failFinalSummary = true;
    reposHook.holdGate = holdGate;
    reposHook.onHoldStart = held;
    setTransportFetch((() => sseResponse(["نص جزئي محفوظ"])) as unknown as typeof fetch);
    const s = await mkSession();
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: seededTurn(s) });
    render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
    await heldPromise;
    const other = await mkSession();
    useSessionsStore.setState((state) => ({ sessions: [...state.sessions, other], currentId: other.id }));
    release();
    await waitFor(async () => {
      const rows = await getMessages(s.id);
      const synth = rows.find((m) => m.kind === "synthesis");
      const prompt = rows.find((m) => m.kind === "prompt" && m.text === "طلب خلاصة من النموذج الأساسي");
      expect(synth?.status).toBe("error");
      expect(synth?.text).toBe("نص جزئي محفوظ");
      expect(synth?.error).toBe("فشل تخزين داخلي");
      expect(synth?.attemptId).toBe(prompt?.attemptId);
      expect(synth?.operationId).toBe(prompt?.operationId);
      expect(synth?.usage).toBeTruthy();
      expect(synth?.attemptId).toBeTruthy();
      expect(synth?.operationId).toBeTruthy();
    }, { timeout: 3000 });
  });

  it("تبديل الجلسة أثناء البث لا يقطع تجميع النص الأصلي ولا يفقد أرشيف خطأ الكتابة النهائية", async () => {
    const sink = memoryFileSink();
    setFileSink(sink);
    let release!: () => void;
    const releaseGate = new Promise<void>((resolve) => { release = resolve; });
    const chunk = (value: string) => new TextEncoder().encode("data: " + JSON.stringify({ choices: [{ delta: { content: value } }] }) + "\n\n");
    setTransportFetch((() => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(chunk("قبل"));
        void releaseGate.then(() => {
          controller.enqueue(chunk("بعد"));
          controller.close();
        });
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch);
    reposHook.failFinalSummary = true;
    const s = await mkSession();
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: doneTurn(s) });
    render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
    await vi.waitFor(() => {
      const synth = useSessionsStore.getState().messages.find((m) => m.kind === "synthesis");
      expect(synth?.text).toBe("قبل");
    }, { timeout: 3000 });
    const other = await mkSession();
    useSessionsStore.setState((state) => ({ sessions: [...state.sessions, other], currentId: other.id }));
    release();
    await waitFor(async () => {
      const synth = (await getMessages(s.id)).find((m) => m.kind === "synthesis");
      expect(synth?.status).toBe("error");
      expect(synth?.text).toBe("قبلبعد");
    }, { timeout: 3000 });
    await waitFor(async () => expect((await getSession(s.id))?.onDiskDir).toBeTruthy(), { timeout: 3000 });
    const dir = "sessions/" + (await getSession(s.id))?.onDiskDir;
    await waitFor(async () => expect(await sink.exists(dir + "/meta.json")).toBe(true), { timeout: 3000 });
    const sessionMd = await sink.readFile(dir + "/session.md");
    const resultFile = await sink.readFile(dir + "/turns/t01/01_synthesis__primary.md");
    const archived = JSON.parse(await sink.readFile(dir + "/meta.json"));
    const archivedResult = archived.turns[0].results[0];
    expect(sessionMd).toContain("قبلبعد");
    expect(resultFile).toContain("قبلبعد");
    expect(archived.turns[0].results[0].text).toBe("قبلبعد");
    expect(archived.turns[0].status[archivedResult.targetId]).toBe("error");
    expect(archived.turns[0].errors[archivedResult.targetId]).toBe("فشل تخزين داخلي");
    expect(sessionMd).toContain("⛔ فشل تخزين داخلي");
    expect(resultFile).toContain("⛔ فشل تخزين داخلي");
  });

  it("الخلاصة الناجحة تُؤرشف على القرص: تمريرة synthesis في session.md وturns لا Dexie وحده", async () => {
    const sink = memoryFileSink();
    setFileSink(sink);
    const s = await mkSession();
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: seededTurn(s) });
    render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
    expect(await screen.findByText("خلاصة النموذج الأساسي")).toBeInTheDocument();
    await waitFor(async () => expect((await getSession(s.id))?.onDiskDir).toBeTruthy(), { timeout: 3000 });
    const dir = "sessions/" + (await getSession(s.id))?.onDiskDir;
    await waitFor(async () => expect(await sink.exists(dir + "/session.md")).toBe(true), { timeout: 3000 });
    const md = await sink.readFile(dir + "/session.md");
    expect(md).toContain("## تمرّة 1");
    // أرشفة المحتوى لا الشاهد: نص الخلاصة الفعلي مقتبسًا ونتيجة بمدخل نصها (يعيد parser بناءها)
    expect(md).toContain("> أهلاً");
    expect(md).toContain("### خلاصة النموذج الأساسي (synthesis)");
    expect(md).toContain("أهلاً");
    const metaJson = JSON.parse(await sink.readFile(dir + "/meta.json"));
    expect(metaJson.turns).toHaveLength(1);
    expect(metaJson.turns[0].turn.id).toMatch(/^syn-/);
    expect(metaJson.turns[0].turn.sharedPrompt).toBe("أهلاً");
    expect(metaJson.turns[0].prompts).toEqual([]);
    const result0 = metaJson.turns[0].results[0];
    expect(result0.text).toBe("أهلاً");
    expect(typeof result0.targetId).toBe("string");
    expect(result0.usage).toBeTruthy();
    expect(metaJson.turns[0].status[result0.targetId]).toBe("done");
  });

  it.each([
    { status: "error" as const, error: "خطأ الأرشفة التجريبي" },
    { status: "stopped" as const, error: undefined },
  ])("نتيجة الخلاصة $status تُؤرشف بنصها وحالتها وخطئها الدقيق", async ({ status, error }) => {
    const sink = memoryFileSink();
    setFileSink(sink);
    summaryDispatchHook.forceStatus = status;
    summaryDispatchHook.forceError = error;
    setTransportFetch((() => sseResponse(["نص الأرشفة الدقيق"])) as unknown as typeof fetch);
    const s = await mkSession();
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: seededTurn(s) });
    render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
    await waitFor(async () => {
      const synth = (await getMessages(s.id)).find((m) => m.kind === "synthesis");
      expect(synth?.status).toBe(status);
    }, { timeout: 3000 });
    await waitFor(async () => expect((await getSession(s.id))?.onDiskDir).toBeTruthy(), { timeout: 3000 });
    const dir = "sessions/" + (await getSession(s.id))?.onDiskDir;
    await waitFor(async () => expect(await sink.exists(dir + "/meta.json")).toBe(true), { timeout: 3000 });
    const sessionMd = await sink.readFile(dir + "/session.md");
    const resultFile = await sink.readFile(dir + "/turns/t01/01_synthesis__primary.md");
    const metaJson = JSON.parse(await sink.readFile(dir + "/meta.json"));
    const archived = metaJson.turns[0];
    expect(sessionMd).toContain("نص الأرشفة الدقيق");
    expect(resultFile).toContain("نص الأرشفة الدقيق");
    expect(archived.results[0].text).toBe("نص الأرشفة الدقيق");
    expect(archived.status[archived.results[0].targetId]).toBe(status);
    expect(archived.errors[archived.results[0].targetId]).toBe(error);
    if (error) {
      expect(sessionMd).toContain("⛔ " + error);
      expect(resultFile).toContain("⛔ " + error);
    }
  });

  it("فشل الأرشفة لا يمس صف الخلاصة في Dexie: النص سليم وstatus done مع توست تحذيري", async () => {
    const base = memoryFileSink();
    // سينك يرمي عند أول كتابة: appendTurn يفشل بعد اكتمال البث والثبات الناجح
    const failingSink: FileSink = { ...base, writeFile: async () => { throw new Error("قرص ممتلئ"); } };
    setFileSink(failingSink);
    const s = await mkSession();
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: seededTurn(s) });
    const warnSpy = vi.spyOn(toast, "warning");
    render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
    await waitFor(async () => { const synth = (await getMessages(s.id)).find((m) => m.kind === "synthesis"); expect(synth?.status, "synthErr=" + synth?.error).toBe("done"); }, { timeout: 4000 });
    // انتظار اكتمال سلسلة الأرشفة (فشلها وتوستها) — قد تحسم بعد ثبات صف Dexie بقليل
    await waitFor(() => expect(warnSpy).toHaveBeenCalledWith("حُفظت الخلاصة محليًا وفشل أرشفتها على القرص"), { timeout: 3000 });
    const synth = (await getMessages(s.id)).find((m) => m.kind === "synthesis");
    expect(synth?.text).toBe("أهلاً");
    warnSpy.mockRestore();
  });
});

describe("المهمة 4 — المقياس الحقيقي، ووضع السياق، وتوصيل الهوية", () => {
  it("المقياس يستخدم حد التركيز (الاحتياط: أولًا) والحديث لا نسبة مولّدة من السجل", async () => {
    const s = await mkSession();
    useSessionsStore.setState({ sessions: [s], currentId: s.id, messages: [{ id: "m1", sessionId: s.id, turnId: "tr1", createdAt: 1, role: "user", kind: "prompt", text: "x".repeat(3999), promptKind: "shared", status: "done" }] });
    useSettingsStore.setState({ providerKeys: { openrouter: "k", minimax: "k" }, timeoutMs: 5000 });
    const t1 = { targetId: "t1_" + s.id, providerId: "openrouter" as const, modelId: "openai/gpt-4o", modelInfo: { id: "openai/gpt-4o", label: "GPT-4o" } };
    const t2 = { targetId: "t2_" + s.id, providerId: "minimax" as const, modelId: "MiniMax-M2", modelInfo: { id: "MiniMax-M2", label: "MiniMax M2", contextLength: 2000 } };
    useComposerStore.setState({ drafts: { [s.id]: { targets: [t1, t2], syncMode: true, sharedPrompt: "س1", customs: {}, focusTargetId: null } } });
    render(<ChatScreen session={s} />);
    // بلا تركيز: الاحتياط هو الهدف الأول (بلا contextLength) → علامة الجهل «؟» لا 128000 المولّدة (0%/1%)
    expect(screen.getByText("؟")).toBeInTheDocument();
    expect(screen.queryByText("1%")).toBeNull();
    expect(screen.queryByText("0%")).toBeNull();
    // تركيز الهدف الثاني: 1000 رمز تقديرية من 2000 → 50%
    fireEvent.click(screen.getAllByText(/MiniMax-M2/)[0]);
    expect(await screen.findByText("50%")).toBeInTheDocument();
    expect(screen.queryByText("؟")).toBeNull();
  });

  it("تبديل بلا حالة يُثبت صريحًا (updateSession + الحالة الحية) وتظهر شارة المقارنة في الوضع فقط", async () => {
    const s = await mkSession();
    seed(s);
    render(<ChatScreen session={s} />);
    const sw = screen.getByRole("switch", { name: "وضع السياق" });
    expect(sw).not.toBeChecked();
    expect(screen.queryByText("مقارنة stateless")).toBeNull();
    fireEvent.click(sw);
    expect(await screen.findByText("مقارنة stateless")).toBeInTheDocument();
    await waitFor(async () => expect((await getSession(s.id))?.contextMode).toBe("stateless"));
    expect(useSessionsStore.getState().sessions.find((x) => x.id === s.id)?.contextMode).toBe("stateless");
    // العودة إلى stateful أيضًا تُثبت صريحًا في Dexie —لا وضع ضمني
    fireEvent.click(sw);
    await waitFor(async () => expect((await getSession(s.id))?.contextMode).toBe("stateful"));
    expect(useSessionsStore.getState().sessions.find((x) => x.id === s.id)?.contextMode).toBe("stateful");
    expect(screen.queryByText("مقارنة stateless")).toBeNull();
  });

  it("جلسة محفوظة stateless تعرض الشارة فور فتحها (الوضع ليس ضمنيًا)", async () => {
    const s = await mkSession({ contextMode: "stateless" });
    seed(s);
    render(<ChatScreen session={s} />);
    expect(screen.getByText("مقارنة stateless")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "وضع السياق" })).toBeChecked();
  });
});

describe("المهمة 5 — الخلاصة بالحالة الصريحة والنص الجزئي", () => {
  it("استثناء تحديث واجهة البث لا يقطع تجميع الخلاصة ونقطة حفظها", async () => {
    const patchSpy = vi.spyOn(useSessionsStore.getState(), "patchMessage").mockImplementation(() => {
      throw new Error("فشل تحديث واجهة البث");
    });
    setTransportFetch((() => sseResponse(["x".repeat(600)])) as unknown as typeof fetch);
    const s = await mkSession({ title: "patchthrow" });
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: doneTurn(s) });
    render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
    await waitFor(async () => {
      const synth = (await getMessages(s.id)).find((m) => m.kind === "synthesis");
      expect(synth?.status).toBe("done");
      expect(synth?.text).toBe("x".repeat(600));
    }, { timeout: 3000 });
    expect(patchSpy).toHaveBeenCalled();
    expect(reposHook.streamingCalls).toBeGreaterThanOrEqual(2);
  });

  it("يحفظ سياق الجلسة الملتقطة إذا تبدلت الجلسة قبل بدء نداء الخلاصة", async () => {
    let release!: () => void;
    const holdGate = new Promise<void>((resolve) => { release = resolve; });
    let held!: () => void;
    const heldPromise = new Promise<void>((resolve) => { held = resolve; });
    reposHook.holdOnCall = 1;
    reposHook.holdGate = holdGate;
    reposHook.onHoldStart = held;
    let requestBody = "";
    setTransportFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = typeof init?.body === "string" ? init.body : await new Request(input, init).clone().text();
      return sseResponse(["خلاصة"]);
    }) as unknown as typeof fetch);
    const s = await mkSession({ title: "history-switch" });
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: doneTurn(s) });
    render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
    await heldPromise;
    const other = await mkSession({ title: "history-other" });
    useSessionsStore.setState((state) => ({ sessions: [...state.sessions, other], currentId: other.id, messages: [] }));
    release();
    await waitFor(async () => {
      const synth = (await getMessages(s.id)).find((m) => m.kind === "synthesis");
      expect(synth?.status).toBe("done");
    }, { timeout: 3000 });
    expect(requestBody).toContain("جواب");
  });

  it("لا يلمس عرض الجلسة المفتوحة من جديد عملية خلاصة قديمة بعد A ثم B ثم A", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    const chunk = (value: string) => new TextEncoder().encode("data: " + JSON.stringify({ choices: [{ delta: { content: value } }] }) + "\n\n");
    setTransportFetch((() => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(chunk("قبل"));
        entered();
        void gate.then(() => { controller.enqueue(chunk("بعد")); controller.close(); });
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch);
    const s = await mkSession({ title: "reopen-a" });
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: doneTurn(s) });
    const patchSpy = vi.spyOn(useSessionsStore.getState(), "patchMessage");
    const first = render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
    await enteredPromise;
    const patchesBeforeReturn = patchSpy.mock.calls.length;
    first.unmount();
    const other = await mkSession({ title: "reopen-b" });
    useSessionsStore.setState({ currentId: other.id, messages: [] });
    useSessionsStore.setState({ currentId: s.id, messages: doneTurn(s) });
    render(<ChatScreen session={s} />);
    release();
    await waitFor(async () => {
      const synth = (await getMessages(s.id)).find((m) => m.kind === "synthesis");
      expect(synth?.status).toBe("done");
    }, { timeout: 3000 });
    expect(patchSpy.mock.calls.length).toBe(patchesBeforeReturn);
    expect(useSessionsStore.getState().messages.some((m) => m.kind === "synthesis")).toBe(false);
  });

  it("يصرّف نقاط حفظ الخلاصة المسجلة قبل الإغلاق قبل الصف النهائي", async () => {
    let release!: () => void;
    const holdGate = new Promise<void>((resolve) => { release = resolve; });
    let held!: () => void;
    const heldPromise = new Promise<void>((resolve) => { held = resolve; });
    reposHook.holdOnCall = 3;
    reposHook.holdGate = holdGate;
    reposHook.onHoldStart = held;
    summaryDispatchHook.forceStatus = "stopped";
    setTransportFetch((() => sseResponse(["بداية", "x".repeat(600), "y".repeat(600)])) as unknown as typeof fetch);
    const s = await mkSession();
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: doneTurn(s) });
    render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
    await heldPromise;
    await vi.waitFor(() => {
      const synth = useSessionsStore.getState().messages.find((m) => m.kind === "synthesis");
      expect(synth?.text).toBe("بداية" + "x".repeat(600) + "y".repeat(600));
    }, { timeout: 3000 });
    // Yield one event-loop turn so ChatScreen enters settleStream before the first checkpoint is released.
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await waitFor(async () => {
      const synth = (await getMessages(s.id)).find((m) => m.kind === "synthesis");
      expect(synth?.status).toBe("stopped");
      expect(synth?.text).toBe("بداية" + "x".repeat(600) + "y".repeat(600));
    }, { timeout: 3000 });
    expect(reposHook.appendCalls).toBe(5);
    expect(reposHook.streamingCalls).toBe(3);
  });

  it("تبديل الجلسة أثناء انتظار الصف النهائي لا يعرض خطأ الخلاصة القديمة", async () => {
    const sink = memoryFileSink();
    setFileSink(sink);
    let release!: () => void;
    const holdGate = new Promise<void>((resolve) => { release = resolve; });
    let held!: () => void;
    const heldPromise = new Promise<void>((resolve) => { held = resolve; });
    reposHook.holdFinalSummary = true;
    reposHook.holdGate = holdGate;
    reposHook.onHoldStart = held;
    summaryDispatchHook.forceStatus = "error";
    summaryDispatchHook.forceError = "خطأ النتيجة القديمة";
    setTransportFetch((() => sseResponse(["نتيجة"])) as unknown as typeof fetch);
    const s = await mkSession({ onDiskDir: "toast-race-error" });
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: doneTurn(s) });
    const errSpy = vi.spyOn(toast, "error");
    render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
    await heldPromise;
    const other = await mkSession();
    useSessionsStore.setState((state) => ({ sessions: [...state.sessions, other], currentId: other.id }));
    release();
    const dir = "sessions/" + s.onDiskDir;
    await waitFor(async () => expect(await sink.exists(dir + "/meta.json")).toBe(true), { timeout: 3000 });
    expect(errSpy).not.toHaveBeenCalledWith("خطأ النتيجة القديمة");
  });

  it("تبديل الجلسة أثناء فشل الأرشفة لا يعرض تحذير الخلاصة القديمة", async () => {
    const base = memoryFileSink();
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void;
    const archiveGate = new Promise<void>((resolve) => { release = resolve; });
    const failingSink: FileSink = { ...base, writeFile: async (path, content) => {
      if (path.endsWith("/session.md")) {
        entered();
        await archiveGate;
        throw new Error("قرص ممتلئ أثناء الأرشفة");
      }
      return base.writeFile(path, content);
    } };
    setFileSink(failingSink);
    const s = await mkSession({ onDiskDir: "toast-race-warning" });
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: doneTurn(s) });
    const warnSpy = vi.spyOn(toast, "warning");
    render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
    await enteredPromise;
    const other = await mkSession();
    useSessionsStore.setState((state) => ({ sessions: [...state.sessions, other], currentId: other.id }));
    release();
    await waitFor(async () => {
      const synth = (await getMessages(s.id)).find((m) => m.kind === "synthesis");
      expect(synth?.sidecarWarning).toBeTruthy();
    }, { timeout: 3000 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(warnSpy).not.toHaveBeenCalledWith("حُفظت الخلاصة محليًا وفشل أرشفتها على القرص");
  });

  it("الخلاصة تنقطع وسط البث: يحفظ النص الجزئي بحالة خطأ لا صف فارغ ولا بث معلق", async () => {
    const line = "data: " + JSON.stringify({ choices: [{ delta: { content: "بداية" } }] }) + "\n\n";
    const f = (async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(line)); setTimeout(() => c.error(new Error("انقطع الاتصال بالبث")), 40); } }), { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
    setTransportFetch(f);
    const s = await mkSession();
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: doneTurn(s) });
    render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
    await waitFor(async () => {
      const rows = await getMessages(s.id);
      const synth = rows.find((m) => m.kind === "synthesis");
      expect(synth?.status).toBe("error");
      expect(synth?.text).toBe("بداية");
      expect(synth?.attemptId).toBeTruthy();
      expect(synth?.operationId).toBeTruthy();
    }, { timeout: 3000 });
  }, 10000);
});
