import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatScreen } from "./ChatScreen";
import { useSessionsStore } from "@/state/sessionsStore";
import { useComposerStore } from "@/state/composerStore";
import { useSettingsStore } from "@/state/settingsStore";
import { setTransportFetch } from "@/lib/transport/transport";
import { sseMockFetch } from "@/test/mocks/sse";
import { createSession, getMessages, getSession } from "@/lib/db/repos";
import { memoryFileSink, setFileSink } from "@/lib/markdown/sink";
import type { ComposerTarget } from "@/state/composerStore";
import type { ChatMessage, SessionMeta } from "@/types";

let n = 0;
async function mkSession(over: Partial<SessionMeta> = {}): Promise<SessionMeta> {
  n += 1;
  const s: SessionMeta = { id: "cs" + n, title: "جلسة", createdAt: Date.now(), updatedAt: Date.now(), modelIds: [], primaryTarget: null, layoutMode: "vertical", onDisk: false, ...over };
  await createSession(s);
  return s;
}

const TWO: ComposerTarget[] = [
  { targetId: "t1", providerId: "openrouter", modelId: "openai/gpt-4o" },
  { targetId: "t2", providerId: "minimax", modelId: "MiniMax-M2" },
];
const ONE: ComposerTarget[] = [{ targetId: "t1", providerId: "openrouter", modelId: "openai/gpt-4o" }];

function seed(session: SessionMeta, opts: { targets?: ComposerTarget[]; prompt?: string } = {}): void {
  useSessionsStore.setState({ sessions: [session], currentId: session.id, messages: [] });
  useSettingsStore.setState({ providerKeys: { openrouter: "k", minimax: "k" }, timeoutMs: 5000 });
  // معرفات أهداف فريدة لكل اختبار: عمليات إرسال سابقة معلقة (مؤقتات مهلة) قد تكمل بعد انتهاء
  // اختبارها وتكتب في المخزن العام — التفرد يمنع التطابق الخاطئ في مسار الدلتا الاحتياطي.
  const targets = (opts.targets ?? TWO).map((t) => ({ ...t, targetId: t.targetId + "_" + session.id }));
  useComposerStore.setState({ targets, syncMode: true, sharedPrompt: opts.prompt ?? "س1", customs: {}, focusTargetId: null });
}

function doneTurn(session: SessionMeta): ChatMessage[] {
  return [
    { id: "m1", sessionId: session.id, turnId: "tr1", createdAt: 1, role: "user", kind: "prompt", text: "س1", promptKind: "shared", status: "done" },
    { id: "m2", sessionId: session.id, turnId: "tr1", createdAt: 2, role: "assistant", kind: "result", text: "جواب", providerId: "openrouter", modelId: "openai/gpt-4o", targetId: "t1", status: "done" },
    { id: "m3", sessionId: session.id, turnId: "tr1", createdAt: 3, role: "assistant", kind: "result", text: "جواب", providerId: "minimax", modelId: "MiniMax-M2", targetId: "t2", status: "done" },
  ];
}

beforeEach(() => { setTransportFetch(sseMockFetch()); });

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
});
