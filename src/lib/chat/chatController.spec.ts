import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendTurn, type SendArgs, type SendCallbacks } from "./chatController";
import { getFileSink, isFilePersistActive, memoryFileSink, setFileSink } from "@/lib/markdown/sink";
import { setTransportFetch } from "@/lib/transport/transport";
import { sseMockFetch, sseResponse } from "@/test/mocks/sse";
import { createSession, getMessages, getSession, getUsageEvents } from "@/lib/db/repos";
import type { ChatMessage, SessionMeta } from "@/types";

// [المهمة 5] خطاف عزل الثراث الجانبية: جعل recordUsage يفشل يثبت أن الصف الأساسي لا يُمحى
const usageHook = vi.hoisted(() => ({ failUsage: false, calls: 0 }));
// [المهمة 5] خطاف رفض النداء: dispatchTurn يرمي دومًا فيثبت التنظيف وصف الخطأ النهائي
const dispatchHook = vi.hoisted(() => ({ reject: false }));
vi.mock("@/lib/db/repos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/repos")>();
  return {
    ...actual,
    recordUsage: async (ev: Parameters<typeof actual.recordUsage>[0]) => {
      usageHook.calls += 1;
      if (usageHook.failUsage) throw new Error("فشل حفظ الاستهلاك");
      return actual.recordUsage(ev);
    },
  };
});

let n = 0;
async function mkSession(tag: string, over: Partial<SessionMeta> = {}): Promise<SessionMeta> {
  n += 1;
  const s: SessionMeta = { id: "sc" + n + tag, title: "جلسة اختبار", createdAt: Date.parse("2026-09-05T10:00:00Z"), updatedAt: 0, modelIds: [], primaryTarget: null, layoutMode: "vertical", onDisk: false, ...over };
  await createSession(s);
  return s;
}

const targets = [
  { targetId: "t1", providerId: "openrouter" as const, modelId: "openai/gpt-4o" },
  { targetId: "t2", providerId: "minimax" as const, modelId: "MiniMax-M2" },
];

function baseArgs(session: SessionMeta, over: Partial<SendArgs> = {}): SendArgs {
  return {
    session, turn: { id: "turn1", sharedPrompt: "سؤال مشترك؟", customs: {} },
    targets, syncMode: true,
    operationId: "op1",
    contextMode: "stateful",
    historyFor: () => [],
    modelInfoFor: () => ({ id: "m", label: "نموذج", contextLength: 128000 }),
    apiKeyFor: () => "k", sessionHeaderFor: () => undefined,
    externalSignalFor: () => undefined, timeoutMs: 5000,
    ...over,
  };
}

function makeCb(): { c: { deltas: Record<string, string>; deltaOps: string[]; statuses: { op: string; targetId: string; status: ChatMessage["status"]; error?: string }[]; dropped: string[]; droppedOps: string[]; appendedIds: string[] }; cb: SendCallbacks } {
  const c = {
    deltas: {} as Record<string, string>,
    deltaOps: [] as string[],
    statuses: [] as { op: string; targetId: string; status: ChatMessage["status"]; error?: string }[],
    dropped: [] as string[],
    droppedOps: [] as string[],
    appendedIds: [] as string[],
  };
  const cb: SendCallbacks = {
    onDelta: (op, tid, ch) => { c.deltaOps.push(op); c.deltas[tid] = (c.deltas[tid] ?? "") + ch; },
    onStatus: (op, tid, st, err) => { c.statuses.push({ op, targetId: tid, status: st, error: err }); },
    onDropped: (op, ids) => { c.droppedOps.push(op); c.dropped.push(...ids); },
    onAppended: (m) => { c.appendedIds.push(m.id); },
  };
  return { c, cb };
}

beforeEach(() => { setTransportFetch(sseMockFetch()); usageHook.failUsage = false; usageHook.calls = 0; dispatchHook.reject = false; });

vi.mock("@/lib/chat/dispatch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat/dispatch")>();
  return {
    ...actual,
    dispatchTurn: async (args: Parameters<typeof actual.dispatchTurn>[0]) => {
      if (dispatchHook.reject) throw new Error("رفض نداء dispatchTurn");
      return actual.dispatchTurn(args);
    },
  };
});

describe("مُنشّط طبقة الملفات", () => {
  it("افتراضيًا بلا نشاط والقراءة تُفشل، وبعد setFileSink يتفعّل", async () => {
    expect(isFilePersistActive()).toBe(false);
    await expect(getFileSink().readFile("x")).rejects.toThrow(/لا ملفات/);
    setFileSink(memoryFileSink());
    expect(isFilePersistActive()).toBe(true);
  });
});

describe("sendTurn", () => {
  it("إرسال موحد: يحفظ السؤال والنتائج النهائية ويسجل الاستهلاك ويبث الدلتا", async () => {
    const s = await mkSession("ok");
    const { c, cb } = makeCb();
    const msgs = await sendTurn(baseArgs(s), cb);
    expect(c.dropped).toEqual([]);
    expect(msgs).toHaveLength(2);
    const all = await getMessages(s.id);
    const shared = all.find((m) => m.role === "user");
    expect(shared?.text).toBe("سؤال مشترك؟");
    const results = all.filter((m) => m.role === "assistant");
    expect(results.map((r) => r.targetId).sort()).toEqual(["t1", "t2"]);
    expect(results.every((r) => r.status === "done" && r.text === "أهلاً")).toBe(true);
    expect(c.deltas["t1"]).toBe("أهلاً");
    expect(c.statuses.map((x) => x.status)).toEqual(["done", "done"]);
    expect(c.appendedIds).toHaveLength(5); // سؤال + بطاقتا بث + نتيجتان نهائيتان
    const usage = await getUsageEvents({ sessionId: s.id });
    expect(usage).toHaveLength(2);
    expect(usage.every((u) => u.status === "ok" && u.inputTokens === 7 && u.outputTokens === 3)).toBe(true);
  });

  it("السؤال المخصص يُحفظ رسالة مستخدم promptKind=custom مرتبطة بالهدف", async () => {
    const s = await mkSession("custom");
    await sendTurn(baseArgs(s, { syncMode: false, turn: { id: "turn1", sharedPrompt: "مشترك", customs: { t1: "خاص" } } }), makeCb().cb);
    const all = await getMessages(s.id);
    const custom = all.find((m) => m.promptKind === "custom");
    expect(custom?.targetId).toBe("t1");
    expect(custom?.text).toContain("خاص");
    const t2 = all.find((m) => m.targetId === "t2" && m.role === "assistant");
    expect(t2?.text).toBe("أهلاً");
  });

  it("هدف يفشل: النتيجة error مع رسالة مترجمة والبقية done وحدث استهلاك خطأ", async () => {
    const f = sseMockFetch();
    setTransportFetch(((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes("minimax") ? new Response("{}", { status: 401 }) : f(input, init)) as typeof fetch);
    const s = await mkSession("err");
    const { c, cb } = makeCb();
    await sendTurn(baseArgs(s), cb);
    const results = (await getMessages(s.id)).filter((m) => m.role === "assistant");
    const t2 = results.find((r) => r.targetId === "t2")!;
    const t1 = results.find((r) => r.targetId === "t1")!;
    expect(t2.status).toBe("error");
    expect(t2.error).toMatch(/مفتاح/);
    expect(t1.status).toBe("done");
    expect(c.statuses.find((x) => x.targetId === "t2")?.error).toMatch(/مفتاح/);
    const usage = await getUsageEvents({ sessionId: s.id });
    expect(usage.find((u) => u.status === "error")).toBeTruthy();
    expect(usage.find((u) => u.status === "ok")).toBeTruthy();
  });

  it("الحفظ المزدوج: meta.json أولًا ثم قسم تمرّة واحد لكل إرسال بكل النتائج", async () => {
    const sink = memoryFileSink();
    setFileSink(sink);
    expect(isFilePersistActive()).toBe(true);
    const s = await mkSession("disk", { onDiskDir: "2026-09-05_جلسة-اختبار_disk00001" });
    const dir = "sessions/" + s.onDiskDir;
    await sendTurn(baseArgs(s), makeCb().cb);
    const md = await sink.readFile(dir + "/session.md");
    expect(md).toContain("# جلسة: جلسة اختبار");
    expect((md.match(/## تمرّة/g) || []).length).toBe(1);
    expect(md).toContain("### openrouter — openai/gpt-4o");
    expect(md).toContain("أهلاً");
    expect(await sink.exists(dir + "/turns/t01/00_shared-prompt.md")).toBe(true);
    const meta = JSON.parse(await sink.readFile(dir + "/meta.json"));
    expect(meta.turns).toHaveLength(1);
    expect((await getSession(s.id))?.onDisk).toBe(true);
    await sendTurn(baseArgs({ ...s, onDisk: true }, { turn: { id: "turn2", sharedPrompt: "سؤال ثانٍ", customs: {} } }), makeCb().cb);
    const md2 = await sink.readFile(dir + "/session.md");
    expect((md2.match(/## تمرّة/g) || []).length).toBe(2);
    expect(JSON.parse(await sink.readFile(dir + "/meta.json")).turns).toHaveLength(2);
  });

  it("meta.json موجود مسبقًا بتمرّات لا تمحه كتابة الميتا الأولية", async () => {
    const sink = memoryFileSink();
    setFileSink(sink);
    const s = await mkSession("guard", { onDiskDir: "guarddir" });
    await sink.writeFile("sessions/guarddir/meta.json", JSON.stringify({ meta: s, turns: [{ existing: true }] }));
    await sendTurn(baseArgs(s), makeCb().cb);
    const meta = JSON.parse(await sink.readFile("sessions/guarddir/meta.json"));
    expect(meta.turns).toHaveLength(2);
    expect(meta.turns[0].existing).toBe(true);
  });

  it("بلا onDiskDir: لا تُكتب ملفات ولا يُحدَّث onDisk", async () => {
    const sink = memoryFileSink();
    setFileSink(sink);
    const s = await mkSession("web");
    await sendTurn(baseArgs(s), makeCb().cb);
    expect(sink.tree()).toEqual([]);
    expect((await getSession(s.id))?.onDisk).toBe(false);
  });

  it("هدف بلا سؤال يُسقط مع onDropped والبقية تُرسل", async () => {
    const s = await mkSession("drop");
    const { c, cb } = makeCb();
    await sendTurn(baseArgs(s, { syncMode: false, turn: { id: "t", sharedPrompt: null, customs: { t1: "خاص فقط" } } }), cb);
    expect(c.dropped).toEqual(["t2"]);
    const results = (await getMessages(s.id)).filter((m) => m.role === "assistant");
    expect(results.map((r) => r.targetId)).toEqual(["t1"]);
    expect(c.statuses).toHaveLength(1);
  });

  it("الإيقاف الخارجي أثناء البث: النتيجة stopped بنص البدء (نص جزئي محفوظ) ولها attemptId", async () => {
    // بث يُرسل جزءًا أوليًا ثم يتجمّد: الإيقاف لا يعيد وضع خطأ ولا يمحو النص
    let emitted = false;
    const hang = (async (input: RequestInfo | URL) => {
      await new Promise((r) => setTimeout(r, 0));
      const head = "data: " + JSON.stringify({ choices: [{ delta: { content: "بداية" } }] }) + "\n\n";
      if (String(input).includes("minimax")) {
        // الهدف الثاني يُبث النص الجزئي نفسه ثم يتيكم: الإلغاء يحسم نتيجته
        return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(head)); emitted = true; } }), { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return sseResponse(["أهلاً"]);
    }) as unknown as typeof fetch;
    setTransportFetch(hang);
    const s = await mkSession("cancel");
    const ac = new AbortController();
    const { cb } = makeCb();
    const pending = sendTurn(baseArgs(s, { externalSignalFor: () => ac.signal, timeoutMs: 5000 }), cb);
    await new Promise((r) => setTimeout(r, 60));
    expect(emitted).toBe(true);
    ac.abort(new Error("ألغي بواسطة المستخدم"));
    const msgs = await pending;
    const t2 = (await getMessages(s.id)).find((m) => m.targetId === "t2" && m.role === "assistant")!;
    expect(t2.status).toBe("stopped");
    expect(t2.text).toBe("بداية");
    expect(t2.error).toBeUndefined();
    expect(msgs.find((m) => m.targetId === "t2")?.attemptId).toBe(t2.attemptId);
  });

  it("خطأ منتصف البث: يبث الجزء الواصل ثم يفشل النتيجة (تحصين المهمة 8-أ)", async () => {
    const line = "data: " + JSON.stringify({ choices: [{ delta: { content: "بداية" } }] }) + "\n\n";
    const f = (async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(line)); setTimeout(() => c.error(new Error("انقطع الاتصال بالبث")), 20); } }), { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
    setTransportFetch(f);
    const s = await mkSession("midstream");
    const { c, cb } = makeCb();
    await sendTurn(baseArgs(s, { targets: [targets[0]] }), cb);
    expect(c.deltas["t1"]).toBe("بداية");
    const t1 = (await getMessages(s.id)).find((m) => m.targetId === "t1" && m.role === "assistant")!;
    expect(t1.status).toBe("error");
    expect(t1.error).toBeTruthy();
    // [المهمة 5] النص الجزئي الواصل قبل الانقطاع يُحفظ في الصف النهائي ولا يُمحى
    expect(t1.text).toBe("بداية");
    const usage = await getUsageEvents({ sessionId: s.id });
    expect(usage.find((u) => u.status === "error")).toBeTruthy();
  });

  it("operationId يتدفق عبر مرحّات onDelta/onStatus وكل صف محفوظ", async () => {
    const s = await mkSession("op");
    const { c, cb } = makeCb();
    const msgs = await sendTurn(baseArgs(s), cb);
    expect(c.deltaOps.length).toBeGreaterThan(0);
    expect(c.deltaOps.every((o) => o === "op1")).toBe(true);
    expect(c.statuses).toHaveLength(2);
    expect(c.statuses.every((x) => x.op === "op1")).toBe(true);
    expect(c.droppedOps).toEqual([]);
    const all = await getMessages(s.id);
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all.every((m) => m.operationId === "op1")).toBe(true);
    expect(msgs.every((m) => m.operationId === "op1")).toBe(true);
  });

  it("onDropped يمرر operationId قبل الهويات المُسقَطة", async () => {
    const s = await mkSession("opdrop");
    const { c, cb } = makeCb();
    await sendTurn(baseArgs(s, { syncMode: false, turn: { id: "t", sharedPrompt: null, customs: { t1: "خاص فقط" } } }), cb);
    expect(c.dropped).toEqual(["t2"]);
    expect(c.droppedOps).toEqual(["op1"]);
  });

  it("السياق الحالي: stateful يمرر السجلات السابقة إلى dispatch وstateless يرسل السؤال وحده", async () => {
    const s = await mkSession("ctx");
    await sendTurn(baseArgs(s), makeCb().cb);
    const history = (await getMessages(s.id)).filter((m) => m.sessionId === s.id);
    const f2 = sseMockFetch();
    setTransportFetch(f2);
    const tt = { id: "turn2", sharedPrompt: "سؤال ثانٍ", customs: {} };
    await sendTurn(baseArgs(s, { turn: tt, historyFor: () => history }), makeCb().cb);
    const body2 = f2.calls[0]?.body ?? "";
    expect(body2).toContain("سؤال مشترك؟");
    expect(body2).toContain("سؤال ثانٍ");
    const f3 = sseMockFetch();
    setTransportFetch(f3);
    await sendTurn(baseArgs(s, { turn: { id: "turn3", sharedPrompt: "سؤال ثالث", customs: {} }, contextMode: "stateless" }), makeCb().cb);
    const body3 = f3.calls[0]?.body ?? "";
    expect(body3).toContain("سؤال ثالث");
    expect(body3).not.toContain("سؤال مشترك؟");
    expect(body3).not.toContain("سؤال ثانٍ");
  });

  it("assistantIds يعيد استخدام معرف الرسالة عند إعادة المحاولة فلا يتكرر الصف", async () => {
    const s = await mkSession("retry");
    const one = [targets[0]];
    const first = await sendTurn(baseArgs(s, { targets: one }), makeCb().cb);
    const reused = await sendTurn(baseArgs(s, { targets: one, assistantIds: { t1: first[0].id } }), makeCb().cb);
    expect(reused[0].id).toBe(first[0].id);
    const results = (await getMessages(s.id)).filter((m) => m.role === "assistant");
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe("أهلاً");
  });
});

describe("المهمة 5 — الإسناد الدائم للبث الجزئي", () => {
  it("attemptId واحد لكل نداء إرسال: يُرفق بصفوف السؤال والبث والنتيجة وحدث الاستهلاك", async () => {
    const s = await mkSession("attempt");
    const { cb } = makeCb();
    await sendTurn(baseArgs(s), cb);
    const all = await getMessages(s.id);
    const ids = new Set(all.map((m) => m.attemptId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toBeTruthy();
    const usage = await getUsageEvents({ sessionId: s.id });
    expect(usage.length).toBeGreaterThan(0);
    expect(usage.every((u) => u.attemptId === [...ids][0])).toBe(true);
  });

  it("نقطة حفظ أثناء البث: صف بنص جزئي يُكتب قبل النتيجة ثم الصف النهائي بالنص الكامل", async () => {
    const line = "data: " + JSON.stringify({ choices: [{ delta: { content: "بداية" } }] }) + "\n\n";
    const big = "data: " + JSON.stringify({ choices: [{ delta: { content: "x".repeat(600) } }] }) + "\n\n";
    const f = (async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(line)); c.enqueue(new TextEncoder().encode(big)); setTimeout(() => c.error(new Error("انقطع الاتصال بالبث")), 80); } }), { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
    setTransportFetch(f);
    const s = await mkSession("ckpt");
    const { cb } = makeCb();
    await sendTurn(baseArgs(s, { targets: [targets[0]] }), cb);
    const t1 = (await getMessages(s.id)).find((m) => m.targetId === "t1" && m.role === "assistant")!;
    // النتيجة النهائية بأحداث خطأ تحفظ النص الكامل المتراكم
    expect(t1.text).toBe("بداية" + "x".repeat(600));
    expect(t1.status).toBe("error");
  });

  it("عزل ثراث الاستهلاك: فشل recordUsage لا يمحو الصف الأساسي ولا يرفض الإرسال ويضيف تحذيرًا", async () => {
    usageHook.failUsage = true;
    const s = await mkSession("usagefail");
    const { cb } = makeCb();
    const msgs = await sendTurn(baseArgs(s), cb);
    await new Promise((r) => setTimeout(r, 30));
    const row = (await getMessages(s.id)).find((m) => m.targetId === "t1" && m.role === "assistant")!;
    expect(row.status).toBe("done");
    expect(row.text).toBe("أهلاً");
    expect(row.sidecarWarning).toBeTruthy();
    expect(msgs[0].text).toBe("أهلاً");
  });

  it("عزل ثراث الأرشفة: فشل كتابة الملفات لا يمحو الصف الأساسي ويضيف تحذيرًا جانبيًا", async () => {
    const sink = memoryFileSink();
    // الفشل في session.md فقط: صف الأولوية هو الدكسي، والأرشفة (appendTurn) ثراث جانبي
    const failing: typeof sink = { ...sink, writeFile: async (path: string, data: string) => {
      if (path.endsWith("session.md")) throw new Error("قرص ممتلئ");
      return sink.writeFile(path, data);
    } };
    setFileSink(failing);
    const s = await mkSession("archfail", { onDiskDir: "archfaildir" });
    const { cb } = makeCb();
    await sendTurn(baseArgs(s), cb);
    await new Promise((r) => setTimeout(r, 30));
    const row = (await getMessages(s.id)).find((m) => m.targetId === "t1" && m.role === "assistant")!;
    expect(row.status).toBe("done");
    expect(row.text).toBe("أهلاً");
    expect(row.sidecarWarning).toBeTruthy();
  });
});

describe("المهمة 5 — تنظيف نقاط الحفظ وقرض رفض النداء", () => {
  it("قرض رفض النداء: لا صف بث معلق، وكل هدف يحصل صف خطأ نهائي بنصه المتراكم ومعرف المحاولة", async () => {
    dispatchHook.reject = true;
    const s = await mkSession("reject");
    const { cb } = makeCb();
    const msgs = await sendTurn(baseArgs(s), cb);
    await new Promise((r) => setTimeout(r, 300));
    const all = (await getMessages(s.id)).filter((m) => m.role === "assistant");
    expect(all.length).toBe(2);
    expect(all.every((m) => m.status === "error")).toBe(true);
    expect(all.every((m) => (m.error ?? "").includes("رفض نداء dispatchTurn"))).toBe(true);
    // لا صف بث متدلٍ: كل هدف صف واحد فقط (الكتابات تحل محلها put بالمفتاح نفسه)
    const t1rows = all.filter((m) => m.targetId === "t1");
    expect(t1rows).toHaveLength(1);
    expect(msgs[0].attemptId).toBeTruthy();
    // تنظيف المؤقتات: لا نقاط حفظ تفتح بعد الحسم (لا صفوف إضافية)
    await new Promise((r) => setTimeout(r, 300));
    expect(await getMessages(s.id).then((rows) => rows.filter((m) => m.role === "assistant"))).toHaveLength(2);
  });

  it("نقطة حفظ المرصودة أثناء البث: صف بث بنص جزئي يظهر قبل النتيجة النهائية (كل 250مك/512 محرف)", async () => {
        const hold = (async () => new Response(new ReadableStream({
      async start(c) {
        const enc = new TextEncoder();
        const send = (text: string) => enc.encode("data: " + JSON.stringify({ choices: [{ delta: { content: text } }] }) + "\n\n");
        c.enqueue(send("بداية"));
        c.enqueue(send("x".repeat(600)));
        // تعليق البث بعد المحارف: نقطة الحفظ العتبة تُطلق أثناء التعليق
        await new Promise(() => {});
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
    setTransportFetch(hold);
    const s = await mkSession("ckptobs");
    const ac = new AbortController();
    const { cb } = makeCb();
    const pending = sendTurn(baseArgs(s, { targets: [targets[0]], externalSignalFor: () => ac.signal }), cb);
    await new Promise((r) => setTimeout(r, 120));
    const mid = (await getMessages(s.id)).find((m) => m.targetId === "t1" && m.role === "assistant")!;
    // نقطة الحفظ المرصودة: نفس معرف الرسالة، نص جزئي محفوظ(case للتدفق جزئي قبل الحسم)
    expect([mid.status, mid.text.includes("بداية")]).toEqual(["streaming", true]);
    ac.abort(new Error("ألغي بواسطة المستخدم"));
    await pending;
  }, 10000);
});
