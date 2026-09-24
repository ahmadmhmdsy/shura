import { appendMessage, recordUsage, updateSession } from "@/lib/db/repos";
import { newId } from "@/lib/id";
import { buildTurnTargets } from "./turnBuilder";
import { dispatchTurn } from "./dispatch";
import { getFileSink, isFilePersistActive } from "@/lib/markdown/sink";
import { appendTurn, writeSessionMeta } from "@/lib/markdown/writer";
import type { BuiltPrompt, ChatMessage, ContextMode, ModelInfo, ProviderId, SessionMeta, Turn } from "@/types";

export interface SendCallbacks {
  // [مرحلة نطاق دائم] كل نداء مرتبط بهوية العملية: operationId أولًا ثم targetId.
  onDelta(operationId: string, targetId: string, chunk: string): void;
  onStatus(operationId: string, targetId: string, status: ChatMessage["status"], error?: string): void;
  onDropped(operationId: string, targetIds: string[]): void;
  // [انحراف موثق 4/8 عن كود الخطة] الخطة تستدعي repos.appendMessage فقط فلا تصل الرسائل
  // إلى واجهة العرض مطلقًا (ChatScreen في كود الخطة يفكك appendMessageLocal ولا يستدعيه).
  // إشعار اختياري بعد كل حفظ تعكس الشاشة به الرسائل إلى المخزن المحلي.
  onAppended?(msg: ChatMessage): void;
}

export interface SendArgs {
  session: SessionMeta;
  turn: Turn;
  targets: { targetId: string; providerId: ProviderId; modelId: string }[];
  syncMode: boolean;
  apiKeyFor(providerId: ProviderId): string;
  sessionHeaderFor(providerId: ProviderId): Record<string, string> | undefined;
  externalSignalFor(targetId: string): AbortSignal | undefined;
  timeoutMs: number;
  // [انحراف موثق 5/8 عن كود الخطة] لإعادة المحاولة: استخدام معرف رسالة النتيجة نفسه
  // بدل توليد معرف جديد، فتستبدل النتيجة النهائية الصف القديم (put بالمفتاح نفسه)
  // ولا تتضاعف البطاقات في الواجهة ولا صفوف Dexie.
  assistantIds?: Record<string, string>;
  // [شريحة المهمة 4 — المتحكم] هوية العملية وسياق الهدف يُمرَّران كما هما إلى dispatchTurn؛
  // بلا افتراضات قديمة: المتصلون المباشر في الاختبارات حدُثوا، وشاشة الاتصال في الشريحة التالية.
  operationId: string;
  contextMode: ContextMode;
  historyFor(targetId: string): readonly ChatMessage[];
  modelInfoFor(targetId: string): ModelInfo;
}

function userMsg(sessionId: string, turnId: string, operationId: string, text: string, promptKind: "shared" | "custom", targetId?: string, attemptId?: string): ChatMessage {
  return { id: newId("m"), sessionId, turnId, createdAt: Date.now(), role: "user", kind: "prompt", text, promptKind, targetId, status: "done", operationId, attemptId };
}

export async function sendTurn(args: SendArgs, cb: SendCallbacks): Promise<ChatMessage[]> {
  const { session, turn } = args;
  const built = buildTurnTargets(turn, args.targets, args.syncMode);
  if (built.dropped.length) cb.onDropped(args.operationId, built.dropped);
  // [المهمة 5] معرف محاولة واحد لكل نداء إرسال (هوية إسناد فقط — سجل TurnAttempt مثبت للمهمة 6)
  const attemptId = newId("at");

  const sink = getFileSink();
  const dir = args.session.onDiskDir ? `sessions/${args.session.onDiskDir}` : null;
  // [انحراف موثق 2/8 عن كود الخطة] الخطة تفحص session.metaWritten وهي ليست حقلًا في SessionMeta؛
  // فحص وجود meta.json على الـ sink يحقق الدلالة نفسها (كتابة أولى فقط) ولا يمحو تمرّات موجودة.
  if (dir && !(await sink.exists(dir + "/meta.json"))) await writeSessionMeta(sink, dir, session);

  const emit = async (m: ChatMessage): Promise<void> => { await appendMessage(m); cb.onAppended?.(m); };

  const opId = args.operationId;
  if (turn.sharedPrompt?.trim()) await emit(userMsg(session.id, turn.id, opId, turn.sharedPrompt.trim(), "shared", undefined, attemptId));
  const assistantMsgs: ChatMessage[] = built.prompts.map((p: BuiltPrompt) => ({
    id: args.assistantIds?.[p.targetId] ?? newId("m"),
    sessionId: session.id, turnId: turn.id, createdAt: Date.now(),
    role: "assistant" as const, kind: "result" as const, text: "",
    providerId: p.providerId, modelId: p.modelId, targetId: p.targetId, status: "streaming" as const,
    operationId: opId, attemptId,
  }));
  for (const p of built.prompts) {
    if (!p.hasCustom) continue;
    await emit(userMsg(session.id, turn.id, opId, p.text, "custom", p.targetId, attemptId));
  }
  for (const m of assistantMsgs) await emit(m);

  // [المهمة 5] تراكم لكل هدف ونقاط حفظ دورية: رقم النهاية الدائم للهدف يقفل الأدوات قبل الكتابة النهائية
  const streams = new Map<string, { accum: string; persistedLen: number; timer: ReturnType<typeof setInterval>; queue: Promise<unknown> }>();
  const finalizedTargets = new Set<string>();
  const checkpointWrite = (targetId: string, text: string): void => {
    const st = streams.get(targetId);
    if (!st) return;
    // كتابة تسلسلية لكل هدف: صف البث نفسه (put بالمفتاح نفسه) بلا سباق مع النتيجة النهائية
    st.queue = st.queue.then(() => {
      if (finalizedTargets.has(targetId)) return;
      const m = assistantMsgs.find((x) => x.targetId === targetId);
      if (!m) return;
      return appendMessage({ ...m, text, status: "streaming" });
    }).catch(() => { /* فشل نقطة حفظ لا يمس الصف النهائي القادم */ });
  };
  const noteChunk = (operationId: string, targetId: string, chunk: string): void => {
    if (operationId !== opId) return; // إهمال ردود عملية/هدف مغاير
    const st = streams.get(targetId);
    if (!st || finalizedTargets.has(targetId)) return; // رد متأخر بعد الحسم: يُهمل
    st.accum += chunk;
    // عتبة الأحرف: 512 محرفًا جديدًا تفرض نقطة حفظ فورية
    if (st.accum.length - st.persistedLen >= 512) { st.persistedLen = st.accum.length; checkpointWrite(targetId, st.accum); }
  };
  for (const p of built.prompts) {
    if (streams.has(p.targetId)) continue;
    // فاصل زمني كل 250مللي ثانية: نقطة حفظ عند نمو النص فقط، ويُطفأ مع الحسم
    const timer = setInterval(() => {
      const st = streams.get(p.targetId);
      if (!st || finalizedTargets.has(p.targetId)) return;
      if (st.accum.length > st.persistedLen) { st.persistedLen = st.accum.length; checkpointWrite(p.targetId, st.accum); }
    }, 250);
    streams.set(p.targetId, { accum: "", persistedLen: 0, timer, queue: Promise.resolve() });
  }
  const settleTarget = async (targetId: string): Promise<void> => {
    const st = streams.get(targetId);
    if (!st) return;
    clearInterval(st.timer);
    finalizedTargets.add(targetId); // قبل انتظار الطابور: أي flush لاحق لا يكتب فوق النتيجة
    await st.queue; // انتظار الكتابات المعلقة قبل الصف النهائي
  };

  let outcomes: Awaited<ReturnType<typeof dispatchTurn>>;
  try {
    outcomes = await dispatchTurn({
      operationId: opId,
      sessionId: session.id, turnId: turn.id, prompts: built.prompts,
      apiKeyFor: args.apiKeyFor, sessionHeaderFor: args.sessionHeaderFor, timeoutMs: args.timeoutMs,
      externalSignalFor: args.externalSignalFor,
      contextMode: args.contextMode,
      historyFor: args.historyFor,
      modelInfoFor: args.modelInfoFor,
      // [-المهمة 5] حرس الهوية/الحسم قبل إعادة توجيه الدلتا للمخزن الحي
      onUpdate: (operationId, targetId, chunk) => {
        if (operationId !== opId || finalizedTargets.has(targetId) || !streams.has(targetId)) return;
        cb.onDelta(operationId, targetId, chunk);
        noteChunk(operationId, targetId, chunk);
      },
    });
  } catch (dispatchErr) {
    // [-المهمة 5] رفض النداء لا يترك صف بث معلق أبدًا: تنظيف المؤقتات وانتظار الطوابير
    // ثم صف خطأ نهائي لكل هدف بنصه المتراكم حتى لا يُمحى أي محتوى محفوظ.
    const message = dispatchErr instanceof Error ? dispatchErr.message : String(dispatchErr);
    const fallback: Record<string, ChatMessage> = {};
    try {
      for (const m of assistantMsgs) {
        const targetId = m.targetId;
        if (!targetId) continue;
        await settleTarget(targetId);
        const text = streams.get(targetId)?.accum ?? "";
        const row: ChatMessage = { ...m, attemptId, text, status: "error", error: message };
        try { await emit(row); } catch { /* الطبقة التخزينية معطلة — فعليات السلوك الحي تنبض بالحالة */ }
        fallback[targetId] = row;
        cb.onStatus(opId, targetId, "error", message);
      }
    } finally {
      // [-المهمة 5] حتى لو رمي emit متأخرًا: كل مؤقت نقاط الحفظ يُنظّف دائمًا
      for (const targetId of streams.keys()) {
        if (!finalizedTargets.has(targetId)) { try { await settleTarget(targetId); } catch { /* تنظيف دائمًا */ } }
      }
    }
    return Object.values(fallback);
  }

  // [المهمة 5] التصنيف النهائي يعتمد DispatchOutcome.status مباشرةً: stopped ليس خطأ أبدًا،
  // والنص/الحالة النهائية تأتي من النتيجة نفسها حيثما كان التراث الجانبي.
  type TerminalWarning = Record<string, string[]>;
  const targetWarnings: TerminalWarning = {};
  const finals: Record<string, ChatMessage> = {};
  try {
  for (const o of outcomes) {
    const msg = assistantMsgs.find((m) => m.targetId === o.targetId)!;
    const prompt = built.prompts.find((p) => p.targetId === o.targetId)!;
    const status: ChatMessage["status"] = o.status;
    await settleTarget(o.targetId);
    const final: ChatMessage = { ...msg, text: o.text, status, error: o.error, usage: o.usage };
    await emit(final);
    finals[o.targetId] = final;
    // [انحراف موثق عن كود الخطة] سطر الخطة «void info ? computeCost(...) : null» ميت بنيويًا:
    // TS2873 يجعل «void info» كاذبًا دائمًا فلا يُنفَّذ الفرع أبدًا (والبث يحسب التكلفة أصلًا
    // في dispatch ويحفظها ضمن usage) — حُذف لتصرَّف السلسلة المفروضة (typecheck/lint).
    // [-المهمة 5] ثراث الاستهلاك معزول بمنع الرفض: فشله يضيف تحذيرًا جانبيًا ولا يمس الصف.
    try {
      await recordUsage({ id: newId("u"), sessionId: session.id, turnId: turn.id, ts: Date.now(), providerId: prompt.providerId, modelId: prompt.modelId, inputTokens: o.usage?.inputTokens ?? 0, outputTokens: o.usage?.outputTokens ?? 0, cachedInputTokens: o.usage?.cachedInputTokens ?? 0, costUSD: o.usage?.costUSD ?? null, toolCalls: 0, durationMs: o.ms, status: o.status === "error" ? "error" : "ok", attemptId });
    } catch {
      (targetWarnings[o.targetId] ??= []).push("تعذر حفظ حدث الاستهلاك");
    }
    cb.onStatus(opId, o.targetId, status, o.error);
  }
  } finally {
    for (const targetId of streams.keys()) {
      if (!finalizedTargets.has(targetId)) { try { await settleTarget(targetId); } catch { /* تنظيف دائمًا */ } }
    }
  }
  // [انحراف موثق 3/8 عن كود الخطة] appendTurn نقلت خارج حلقة النتائج: داخلها كانت تُستدعى
  // مرة لكل هدف فتُنشئ قسم «تمرّة» لكل نتيجة (وتمرّتين في meta.json لإرسالٍ بهدفين) بنفس المحتوى.
  // [-المهمة 5] الأرشفة ثراث جانبي معزول: فشلها بعد الصف الأساسي لا يمحو النص ولا يرفض sendTurn،
  // والنص/الحالة المأرشفة هي الصف النهائي نفسه (نص جزئي محفوظ حتى مع خطأ — يعرضه الكاتب المحدود).
  if (dir) {
    try {
      await appendTurn(sink, dir, session, {
        turn, prompts: built.prompts.map((p) => ({ targetId: p.targetId, providerId: p.providerId, modelId: p.modelId, text: p.text, hasShared: p.hasShared, hasCustom: p.hasCustom })),
        results: outcomes.map((oo) => ({ targetId: oo.targetId, text: oo.text, usage: oo.usage ?? null })),
        status: Object.fromEntries(outcomes.map((oo) => [oo.targetId, oo.status])),
        errors: Object.fromEntries(outcomes.map((oo) => [oo.targetId, oo.error ?? ""])),
        createdAt: Date.now(),
      });
      await updateSession(session.id, { onDisk: isFilePersistActive() });
    } catch {
      for (const o of outcomes) (targetWarnings[o.targetId] ??= []).push("تعذر أرشفة النتيجة على القرص");
    }
  }
  // تحذيرات ثراث جانبي ظاهرة على الصفوف النهائية دون تغيير الحالة أو النص
  try {
    for (const o of outcomes) {
      const warns = targetWarnings[o.targetId];
      if (!warns?.length) continue;
      const row = { ...finals[o.targetId], sidecarWarning: warns.join(" ؛ ") };
      finals[o.targetId] = row;
      try { await emit(row); } catch { /* فشل كتابة التحذير الجانبي: الصف الناجح يظل سليمًا بلا رفض */ }
    }
  } finally {
    // [-المهمة 5] عُهدة: كل مؤقت نقاط حفظ يُنظّف مهما رمي المسار حتى مع فشل طبقة التخزين
    for (const targetId of streams.keys()) {
      if (!finalizedTargets.has(targetId)) { try { await settleTarget(targetId); } catch { /* تنظيف دائمًا */ } }
    }
  }
  // [-المهمة 5] النتيجة المعادة تحمل النص النهائي (الصف المحفوظ) لا صورة البث المعلقة
  return Object.values(finals);
}
