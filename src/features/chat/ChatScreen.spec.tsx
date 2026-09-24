import { beforeEach, describe, expect, it, vi } from "vitest";
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
const reposHook = vi.hoisted(() => ({ appendCalls: 0, failOnCall: 0 }));
vi.mock("@/lib/db/repos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/repos")>();
  const realAppend = actual.appendMessage;
  return {
    ...actual,
    appendMessage: async (msg: ChatMessage) => {
      reposHook.appendCalls += 1;
      if (reposHook.failOnCall > 0 && reposHook.appendCalls === reposHook.failOnCall) throw new Error("فشل تخزين داخلي");
      return realAppend(msg);
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

beforeEach(() => { setTransportFetch(sseMockFetch()); reposHook.appendCalls = 0; reposHook.failOnCall = 0; });

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
    // ترتيب النداءات: رسالة البدء، رسالة البدء للبطاقة، ثم الثبات النهائي — الفشل في الثالث
    // يحاكي خطأ طبقة تخزين داخليًا بعد اكتمال البث؛ يجب أن تنهي البطاقة حالتها بخطأ ظاهر
    reposHook.failOnCall = 3;
    render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
    expect(await screen.findByText("فشل تخزين داخلي", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText("يكتب…")).not.toBeInTheDocument();
    await waitFor(async () => expect((await getMessages(s.id)).find((m) => m.kind === "synthesis")?.status).toBe("error"), { timeout: 3000 });
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

  it("فشل الخلاصة لا يُؤرشف على القرص (قرار: الفشل لا يُؤرشف)", async () => {
    const sink = memoryFileSink();
    setFileSink(sink);
    const s = await mkSession();
    seed(s, { targets: ONE });
    useSessionsStore.setState({ messages: seededTurn(s) });
    setTransportFetch(((input: RequestInfo | URL, init?: RequestInit) => { void input; void init; return new Response("{}", { status: 401 }); }) as unknown as typeof fetch);
    render(<ChatScreen session={s} />);
    fireEvent.click(screen.getByRole("button", { name: /استخرج خلاصة/ }));
    expect(await screen.findByText(/مفتاح غير صالح/, {}, { timeout: 3000 })).toBeInTheDocument();
    expect((await getSession(s.id))?.onDiskDir ?? null).toBeFalsy();
    expect(sink.tree().some((t) => t.startsWith("sessions/"))).toBe(false);
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
