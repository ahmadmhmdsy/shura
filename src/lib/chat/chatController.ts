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

function userMsg(sessionId: string, turnId: string, operationId: string, text: string, promptKind: "shared" | "custom", targetId?: string): ChatMessage {
  return { id: newId("m"), sessionId, turnId, createdAt: Date.now(), role: "user", kind: "prompt", text, promptKind, targetId, status: "done", operationId };
}

export async function sendTurn(args: SendArgs, cb: SendCallbacks): Promise<ChatMessage[]> {
  const { session, turn } = args;
  const built = buildTurnTargets(turn, args.targets, args.syncMode);
  if (built.dropped.length) cb.onDropped(args.operationId, built.dropped);

  const sink = getFileSink();
  const dir = args.session.onDiskDir ? `sessions/${args.session.onDiskDir}` : null;
  // [انحراف موثق 2/8 عن كود الخطة] الخطة تفحص session.metaWritten وهي ليست حقلًا في SessionMeta؛
  // فحص وجود meta.json على الـ sink يحقق الدلالة نفسها (كتابة أولى فقط) ولا يمحو تمرّات موجودة.
  if (dir && !(await sink.exists(dir + "/meta.json"))) await writeSessionMeta(sink, dir, session);

  const emit = async (m: ChatMessage): Promise<void> => { await appendMessage(m); cb.onAppended?.(m); };

  const opId = args.operationId;
  if (turn.sharedPrompt?.trim()) await emit(userMsg(session.id, turn.id, opId, turn.sharedPrompt.trim(), "shared"));
  const assistantMsgs: ChatMessage[] = built.prompts.map((p: BuiltPrompt) => ({
    id: args.assistantIds?.[p.targetId] ?? newId("m"),
    sessionId: session.id, turnId: turn.id, createdAt: Date.now(),
    role: "assistant" as const, kind: "result" as const, text: "",
    providerId: p.providerId, modelId: p.modelId, targetId: p.targetId, status: "streaming" as const,
    operationId: opId,
  }));
  for (const p of built.prompts) {
    if (!p.hasCustom) continue;
    await emit(userMsg(session.id, turn.id, opId, p.text, "custom", p.targetId));
  }
  for (const m of assistantMsgs) await emit(m);

  const outcomes = await dispatchTurn({
    operationId: opId,
    sessionId: session.id, turnId: turn.id, prompts: built.prompts,
    apiKeyFor: args.apiKeyFor, sessionHeaderFor: args.sessionHeaderFor, timeoutMs: args.timeoutMs,
    externalSignalFor: args.externalSignalFor,
    contextMode: args.contextMode,
    historyFor: args.historyFor,
    modelInfoFor: args.modelInfoFor,
    onUpdate: (operationId, targetId, chunk) => cb.onDelta(operationId, targetId, chunk),
  });

  for (const o of outcomes) {
    const msg = assistantMsgs.find((m) => m.targetId === o.targetId)!;
    const prompt = built.prompts.find((p) => p.targetId === o.targetId)!;
    const status: ChatMessage["status"] = o.ok ? "done" : "error";
    const final: ChatMessage = { ...msg, text: o.text, status, error: o.error, usage: o.usage };
    await emit(final);
    await recordUsage({ id: newId("u"), sessionId: session.id, turnId: turn.id, ts: Date.now(), providerId: o.ok ? prompt.providerId : prompt.providerId, modelId: prompt.modelId, inputTokens: o.usage?.inputTokens ?? 0, outputTokens: o.usage?.outputTokens ?? 0, cachedInputTokens: o.usage?.cachedInputTokens ?? 0, costUSD: o.usage?.costUSD ?? null, toolCalls: 0, durationMs: o.ms, status: o.ok ? "ok" : "error" });
    // [انحراف موثق عن كود الخطة] سطر الخطة «void info ? computeCost(...) : null» ميت بنيويًا:
    // TS2873 يجعل «void info» كاذبًا دائمًا فلا يُنفَّذ الفرع أبدًا (والبث يحسب التكلفة أصلًا
    // في dispatch ويحفظها ضمن usage) — حُذف لتصرَّف السلسلة المفروضة (typecheck/lint).
    cb.onStatus(opId, o.targetId, status, o.error);
  }
  // [انحراف موثق 3/8 عن كود الخطة] appendTurn نقلت خارج حلقة النتائج: داخلها كانت تُستدعى
  // مرة لكل هدف فتُنشئ قسم «تمرّة» لكل نتيجة (وتمرّتين في meta.json لإرسالٍ بهدفين) بنفس المحتوى.
  if (dir) {
    await appendTurn(sink, dir, session, {
      turn, prompts: built.prompts.map((p) => ({ targetId: p.targetId, providerId: p.providerId, modelId: p.modelId, text: p.text, hasShared: p.hasShared, hasCustom: p.hasCustom })),
      results: outcomes.map((oo) => ({ targetId: oo.targetId, text: oo.text, usage: oo.usage ?? null })),
      status: Object.fromEntries(outcomes.map((oo) => [oo.targetId, oo.ok ? "done" : "error"])),
      errors: Object.fromEntries(outcomes.map((oo) => [oo.targetId, oo.error ?? ""])),
      createdAt: Date.now(),
    });
    await updateSession(session.id, { onDisk: isFilePersistActive() });
  }
  return assistantMsgs;
}
