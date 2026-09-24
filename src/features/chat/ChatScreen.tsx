import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { toast } from "sonner";
import { Composer } from "./Composer";
import { TurnView } from "./TurnView";
import { useSessionsStore } from "@/state/sessionsStore";
import { useComposerStore, emptyComposerDraft } from "@/state/composerStore";
import { useSettingsStore } from "@/state/settingsStore";
import { estimateSessionTokens } from "@/lib/tokens/estimate";
import { sendTurn } from "@/lib/chat/chatController";
import { dispatchTurn } from "@/lib/chat/dispatch";
import { buildSummaryPrompt } from "@/lib/chat/synthesis";
import { newId } from "@/lib/id";
import { appendMessage, recordUsage, updateSession } from "@/lib/db/repos";
import { getFileSink, isFilePersistActive } from "@/lib/markdown/sink";
import { appendTurn, sessionFolderName } from "@/lib/markdown/writer";
import { ar } from "@/i18n/ar";
import type { ChatMessage, ContextMode, SessionMeta, Turn } from "@/types";

export function ChatScreen({ session }: { session: SessionMeta }) {
  // الربط الموقّع: كل القراءات والأكشنات تحمل معرف الجلسة نفسه — لا سطح مؤلف شامل بعد الخطوة 5
  const sessionId = session.id;
  const messages = useSessionsStore((s) => s.messages);
  const patchMessage = useSessionsStore((s) => s.patchMessage);
  const upsertMessagesLocal = useSessionsStore((s) => s.upsertMessagesLocal);
  const appendMessageLocal = useSessionsStore((s) => s.appendMessageLocal);
  const setTargets = useSessionsStore((s) => s.setTargets);
  const { targets, syncMode, sharedPrompt, customs, focusTargetId } = useComposerStore(useShallow((s) => {
    const d = s.drafts[sessionId] ?? emptyComposerDraft();
    return { targets: d.targets, syncMode: d.syncMode, sharedPrompt: d.sharedPrompt, customs: d.customs, focusTargetId: d.focusTargetId };
  }));
  const settings = useSettingsStore();
  const [sending, setSending] = useState(false);
  // [المهمة 4 - وضع السياق] قراءة حية من مخزن الجلسات (التبديل يعيد الرسم بلا remount):
  // session.contextMode غائب في الصفوف القديمة بالتالي stateful افتراضي ولا stateless ضمني أبدًا.
  const liveSession = useSessionsStore((s) => s.sessions.find((x) => x.id === sessionId));
  const contextMode: ContextMode = liveSession?.contextMode ?? session.contextMode ?? "stateful";
  // [المهمة 4 - المقياس = الإرسال] الهدف محل التركيز (احتياطًا: الهدف الأول) مصدر حد المقياس،
  // لا نسب مولدة من سجل المزودين ولا 128000 الافتراضي؛ غياب البيانات يظل علامة جهل صادقة.
  const focusTarget = targets.find((t) => t.targetId === focusTargetId) ?? targets[0] ?? null;
  const contextLimit: number | null = focusTarget?.modelInfo.contextLength ?? null;
  // تثبيت الأهداف المختارة في بيانات الجلسة (Dexie + القائمة المحلية): فقط عند تغيير مصفوفة الأهداف نفسها
  // (إضافة/إزالة/تلقيم بذرة) — الكتابة النصية للمؤلف تحفظ مرجع المصفوفة فلا تلمس Dexie.
  useEffect(() => {
    // المرجع: .superpowers/sdd/hardening-task-3-target-fix.md — فشل حفظ الأهداف يُبتر تاريخًا
    // ظاهريًا: تحذير عام بلا تفاصيل التخزين/المسار/المفاتيح، والأهداف تبقى محليًا في المخزن.
    setTargets(sessionId, targets).catch(() => {
      toast.warning("تعذر حفظ الأهداف في بيانات الجلسة — ستبقى محليًا فحسب");
    });
  }, [setTargets, sessionId, targets]);
  // ديدان الاستعارة المتبقية تُهمل هنا: remount عبر key في App يضمن خلو كل مرجع متأخر من جلسة سابقة
  const aborts = useRef(new Map<string, AbortController>());
  // أهداف أوقفها المستخدم في التمرّة الجارية: نتيجة الإلغاء تصلف خطأً من dispatch
  // لكن البطاقة تبقى «أُوقف» ولا تتحول إلى خطأ ولا تُطلق تنبيهًا.
  const stopped = useRef(new Set<string>());
  // [مراجعة المهمة 3 — هوية العملية] لكل نداء persistTurn رقم فريد: انطلاق عملية أحدث في
  // الجلسة نفسها ينقض العمليات الأقدم — تقاطع بندا الدالة (الجلسة + الرمز) هو فحص الثبات
  // الوحيد المسموح له بتحريك الحالة الحية/التوست/تنظيف الموارد ما دام الرمز والجلسة شارفيْن.
  const operationRef = useRef(0);
  // [دور إصلاح مأذون — بند 2] حارس إعادة دخول الخلاصة: مرجع متزامن (لا حالة) يغلق ثغرة الإغلاق
  // القديم بين نقرتين متتاليتين في نفس اللمسة — حالة useState لا تصلح هنا لأن كل نقر يقرأ لقطة قديمة.
  const extractingRef = useRef(false);
  const sessionTokens = useMemo(() => estimateSessionTokens(messages), [messages]);

  const turns = useMemo(() => {
    const map = new Map<string, { prompts: ChatMessage[]; results: ChatMessage[] }>();
    for (const m of messages) {
      const t = map.get(m.turnId) ?? { prompts: [], results: [] };
      (m.role === "user" ? t.prompts : t.results).push(m);
      map.set(m.turnId, t);
    }
    return [...map.entries()];
  }, [messages]);

  const customPrompts = Object.fromEntries(targets.map((t) => [t.targetId, (customs[t.targetId] ?? "").trim() || null]));

  async function doSend(): Promise<void> {
    if (sending) return;
    const turn: Turn = { id: newId("turn"), sharedPrompt: sharedPrompt, customs: { ...customs } };
    await persistTurn(turn);
  }

  async function persistTurn(turn: Turn, retryTargetId?: string, baseResults?: ChatMessage[], assistantIds?: Record<string, string>): Promise<void> {
    const signalTargets = retryTargetId ? targets.filter((t) => t.targetId === retryTargetId) : targets;
    const turnForTargets: Turn = retryTargetId ? { ...turn, customs: { [retryTargetId]: (customs[retryTargetId] ?? "") } } : turn;
    setSending(true);
    // [مراجعة المهمة 3 — هوية العملية] الرمز يُملأ هنا متزامنًا قبل أي await: عملية أحدث في
    // الجلسة نفسها تزيد العداد فينسقط كل رمز أقدم — حارس الجلسة السابق يبقى كما هو داخل الفحص.
    const opToken = ++operationRef.current;
    // [المهمة 4 - توصيل الهوية] معرف عملية صريح (نص) يُنشر في رسائل التمريرة ويُحمل داخل كل نداء:
    // ردّ يحمل معرفًا مغايرًا يُرفض حتى لو كان الجلسة والرمز شارفيْن.
    const opId = newId("op");
    // دالة الثبات المشتركة: رمز هذه العملية ما يزال هو الحالي وجلستها هي المفتوحة.
    const isCurrent = () => (useSessionsStore.getState().currentId === sessionId && operationRef.current === opToken);
    const isSameOperation = (oid: string) => oid === opId;
    // المخلفات المتيمة: إدخالات الإيقاف/الإلغاء لعمليات أقدم منقوضة لا تستحق البقاء — تُطهر
    // قبل تسجيل إشارات هذه العملية؛ تنظيف الأقدم المتأخر في finally مرشّح بـ isCurrent فلا يلمسها.
    aborts.current.clear();
    stopped.current.clear();
    try {
      // ملاحظة الخطة: onDiskDir يُملأ عند أول إرسال في وضع سطح المكتب فقط (المُنشّط غير مثبت في الويب).
      let effectiveSession = session;
      if (!effectiveSession.onDiskDir && isFilePersistActive()) {
        const folder = sessionFolderName(effectiveSession.title, effectiveSession.id, effectiveSession.createdAt);
        await updateSession(effectiveSession.id, { onDiskDir: folder });
        useSessionsStore.setState((s) => ({ sessions: s.sessions.map((x) => (x.id === effectiveSession.id ? { ...x, onDiskDir: folder } : x)) }));
        effectiveSession = { ...effectiveSession, onDiskDir: folder };
      }
      await sendTurn(
        {
          session: effectiveSession, turn: turnForTargets, targets: signalTargets.map((t) => ({ targetId: t.targetId, providerId: t.providerId, modelId: t.modelId })),
          syncMode: retryTargetId ? false : syncMode,
          operationId: opId,
          contextMode,
          historyFor: () => useSessionsStore.getState().messages,
          modelInfoFor: (tid) => targets.find((t) => t.targetId === tid)?.modelInfo ?? { id: tid, label: tid },
          apiKeyFor: (pid) => settings.providerKeys[pid] ?? "",
          sessionHeaderFor: (pid) => (pid === "opencodego" ? { "x-opencode-session": session.id } : undefined),
          // [المهمة 4 - حارس الموارد] إشارات الإلغاء مملوكة لعملية واحدة: نداء من عملية منقوضة
          // لا يسجل إشارة جديدة فوق موارد عملية أحدث (سلوك كان يمكن أن يعطّل زر الإيقاف).
          externalSignalFor: (tid) => {
            // [مراجعة المهمة 4] الفحص القديم isSameOperation(opId) كان يقارن الإغلاق بنفسه فيمر دائمًا،
            // فسمح لعملية منقوضة بتسجيل مرادف فوق مرادف الأحدث في aborts. فحص الثبات الحقيقي هنا هو isCurrent.
            if (!isCurrent()) return undefined;
            const ac = new AbortController(); aborts.current.set(tid, ac); return ac.signal;
          },
          timeoutMs: settings.timeoutMs,
          assistantIds,
        },
        {
          // [انحراف موثق 6/8 عن كود الخطة] الرجوع إلى حالة المخزن الحية بدل مصفوفة messages
          // المقفولة في الإغلاق: كود الخطة يجد آخر رسالة في اللقطة القديمة فيسقط دلتا كل
          // الأهداف إلا الأخيرة، ويجمّع نص إعادة المحاولة من نص قديم بدل النص الحي.
          onDelta: (cbOpId, tid, chunk) => {
            if (!isCurrent() || !isSameOperation(cbOpId)) return;
            const live = useSessionsStore.getState().messages;
            const m = baseResults?.find((x) => x.targetId === tid) ?? [...live].reverse().find((x) => x.targetId === tid && x.role === "assistant");
            if (!m) return;
            const cur = live.find((x) => x.id === m.id) ?? m;
            patchMessage(m.id, { text: cur.text + chunk, status: "streaming" });
          },
          // [المهمة 5] DispatchOutcome.status يصل مصنّفًا من dispatch: stopped يبقى stopped لا error،
          // فلا مجموعة إيقاف تعيد كتابة الحالة، والتوست على خطأ حقيقي فقط.
          onStatus: (cbOpId, tid, st, err) => {
            if (!isCurrent() || !isSameOperation(cbOpId)) return;
            const list = baseResults ?? useSessionsStore.getState().messages;
            const m = [...list].reverse().find((x) => x.targetId === tid && x.role === "assistant");
            if (m) patchMessage(m.id, { status: st, error: err });
            if (st === "error" && err) toast.error(err);
          },
          // [مراجعة المهمة 3 — هوية العملية] onDropped لا يفحص الجلسة داخليًا — يتحقق بـ isCurrent بنفسه
          onDropped: (cbOpId, ids) => { if (ids.length && isCurrent() && isSameOperation(cbOpId)) toast.warning(ar.droppedTargets + " (" + ids.length + ")"); },
          onAppended: (m) => { if (isCurrent()) upsertMessagesLocal([m]); },
        },
      );
    } catch (e) {
      // حارس الإرسال بلا سؤال (تحفظ تنفيذي موجّه لهذه المهمة من مراجعة المهمة 4):
      // buildTurnTargets يرمي رسالة عربية موجّهة للمستخدم — نعرضها بدل رفض وعد صامت.
      // [مراجعة المهمة 3 — هوية العملية] توست الفشل الملتقط مرشّح أيضًا: عملية منقوضة لا توست
      if (isCurrent()) toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      // [مراجعة المهمة 3 — هوية العملية] التنظيف محصور بالعملية الحالية: عملية أقدم منقوضة
      // لا تطفئ sending ولا تطهر aborts/stopped الخاصة بعملية أحدث ما تزال حية في الجلسة نفسها.
      if (isCurrent()) { setSending(false); aborts.current.clear(); stopped.current.clear(); }
    }
  }

  async function extractSummary(): Promise<void> {
    // [دور إصلاح مأذون — بند 2] حارسا إعادة دخول (اختيار موثق: toast معتدل لا تجاهل صامت):
    // مرجع إعادة الدخول أعلاه + «لا خلاصة فوق خلاصة» حين تكون آخر تمريرة syn-؛
    // إضافة نتائج جديدة بعدها تعيد فتح الباب لأن آخر تمريرة تصبح عادية.
    if (extractingRef.current || sending) { toast.warning("جارٍ تنفيذ عملية بالفعل"); return; }
    const last = turns[turns.length - 1];
    if (!last || last[1].results.length === 0) { toast.warning("لا نتائج لاستخلاصها بعد"); return; }
    if (last[0].startsWith("syn-")) { toast.warning("الخلاصة موجودة بالفعل — لا خلاصة فوق خلاصة"); return; }
    const primary = settings.primaryTarget ?? (targets[0] ? { providerId: targets[0].providerId, modelId: targets[0].modelId } : null);
    if (!primary) { toast.warning("حدد النموذج الأساسي من الإعدادات أولًا"); return; }
    const turnId = "syn-" + last[0];
    const msgId = newId("m");
    const synthCreatedAt = Date.now() + 1;
    let placeholderWritten = false;
    // [-المهمة 5] معرف محاولة واحد لعملية الخلاصة (هوية إسناد لا سجل TurnAttempt — مهمة 6)
    const summaryOpId = newId("op");
    const summaryAttemptId = newId("at");
    // [-المهمة 5] نقاط حفظ الخلاصة أثناء البث: تراكم وحفظ كل 250مك أو 512 محرفًا بطابور
    // كتابة تسلسلي؛ الحالة خارج كتلة try حتى يصلها مسار catch وينظف المؤقت مهما رمي النداء.
    let accum = "";
    let persistedLen = 0;
    let streamTerminated = false;
    let checkpointQueue: Promise<unknown> = Promise.resolve();
    const checkpointWrite = (text: string): void => {
      checkpointQueue = checkpointQueue.then(() => {
        if (streamTerminated) return;
        return appendMessage({ id: msgId, sessionId: session.id, turnId, createdAt: synthCreatedAt, role: "assistant", kind: "synthesis", text, providerId: primary.providerId, modelId: primary.modelId, status: "streaming", attemptId: summaryAttemptId, operationId: summaryOpId });
      }).catch(() => { /* فشل نقطة حفظ لا يمس الصف النهائي */ });
    };
    const streamTimer = setInterval(() => {
      if (streamTerminated) return;
      if (accum.length > persistedLen) { persistedLen = accum.length; checkpointWrite(accum); }
    }, 250);
    const settleStream = async (): Promise<void> => {
      clearInterval(streamTimer);
      streamTerminated = true;
      await checkpointQueue;
    };
    const onDelta = (cbOpId: string, tid: string, chunk: string): void => {
      // [-المهمة 5] حرس هوية العملية والهدف قبل أي إعادة توجيه للحالة الحية
      if (cbOpId !== summaryOpId || tid !== msgId || streamTerminated) return;
      if (useSessionsStore.getState().currentId !== session.id) return;
      accum += chunk;
      patchMessage(msgId, { text: accum, status: "streaming" });
      if (accum.length - persistedLen >= 512) { persistedLen = accum.length; checkpointWrite(accum); }
    };
    extractingRef.current = true;
    try {
      const prompt = buildSummaryPrompt(last[0], last[1].results);
      await appendMessageLocal({ id: newId("m"), sessionId: session.id, turnId, createdAt: Date.now(), role: "user", kind: "prompt", text: "طلب خلاصة من النموذج الأساسي", promptKind: "shared", status: "done", operationId: summaryOpId, attemptId: summaryAttemptId });
      await appendMessageLocal({ id: msgId, sessionId: session.id, turnId, createdAt: synthCreatedAt, role: "assistant", kind: "synthesis", text: "", providerId: primary.providerId, modelId: primary.modelId, status: "streaming", attemptId: summaryAttemptId, operationId: summaryOpId });
      placeholderWritten = true;
      // [-المهمة 4] الخلاصة تعبر نفس العقود: هوية عملية صريحة، وضع سياق، تاريخ وحد النموذج.
      const summaryInfo = targets.find((t) => t.providerId === primary.providerId && t.modelId === primary.modelId)?.modelInfo ?? targets[0]?.modelInfo ?? { id: primary.modelId, label: primary.modelId };
      let outcome: Awaited<ReturnType<typeof dispatchTurn>>[number];
      try {
        outcome = (await dispatchTurn({ operationId: summaryOpId, sessionId: session.id, turnId, prompts: [{ targetId: msgId, providerId: primary.providerId, modelId: primary.modelId, text: prompt, hasShared: true, hasCustom: false }], apiKeyFor: (pid) => settings.providerKeys[pid] ?? "", sessionHeaderFor: (pid) => (pid === "opencodego" ? { "x-opencode-session": session.id } : undefined), timeoutMs: settings.timeoutMs, contextMode, historyFor: () => useSessionsStore.getState().messages, modelInfoFor: () => summaryInfo, onUpdate: onDelta }))[0];
      } finally {
        // [-المهمة 5] مهما رمي النداء: تنظيف المؤقت وانتظار الكتابات المعلقة أولا — لا بث معلق أبدي
        await settleStream();
      }
      const stale = useSessionsStore.getState().currentId !== session.id;
      // [-المهمة 5] DispatchOutcome.status مباشرةً: stopped يثبت بنصه الجزئي ولا يُلوَن خطأ،
      // والصف النهائي يُكتب دائمًا بنص/حالة النتيجة نفسها.
      const finalMsg: ChatMessage = { id: msgId, sessionId: session.id, turnId, createdAt: synthCreatedAt, role: "assistant", kind: "synthesis", text: outcome.text, providerId: primary.providerId, modelId: primary.modelId, status: outcome.status, error: outcome.error, usage: outcome.usage, attemptId: summaryAttemptId, operationId: summaryOpId };
      await appendMessage(finalMsg);
      if (!stale) upsertMessagesLocal([finalMsg]);
      if (outcome.status === "error" && !stale) toast.error(outcome.error ?? "فشل");
      // [-المهمة 5] ثراث الاستهلاك معزول: فشله يضيف تحذيرًا جانبيًا ظاهرًا ولا يمس نص/حالة الخلاصة
      let sidecar: string | undefined = undefined;
      try {
        await recordUsage({ id: newId("u"), sessionId: session.id, turnId, ts: Date.now(), providerId: primary.providerId, modelId: primary.modelId, inputTokens: outcome.usage?.inputTokens ?? 0, outputTokens: outcome.usage?.outputTokens ?? 0, cachedInputTokens: outcome.usage?.cachedInputTokens ?? 0, costUSD: outcome.usage?.costUSD ?? null, toolCalls: 0, durationMs: outcome.ms, status: outcome.status === "error" ? "error" : "ok", attemptId: summaryAttemptId });
      } catch {
        sidecar = "تعذر حفظ حدث الاستهلاك";
      }
      // [-المهمة 5] الأرشفة ثراث جانبي معزول: النص/الحالة المأرشفة هي الصف النهائي نفسه،
      // وفشلها لا يمس صف الخلاصة الناجح إطلاقًا (درس (أ)-5).
      if (outcome.status === "done" && isFilePersistActive()) {
        try {
          let effectiveSession = session;
          if (!effectiveSession.onDiskDir) {
            const folder = sessionFolderName(effectiveSession.title, effectiveSession.id, effectiveSession.createdAt);
            await updateSession(effectiveSession.id, { onDiskDir: folder });
            useSessionsStore.setState((st) => ({ sessions: st.sessions.map((x) => (x.id === effectiveSession.id ? { ...x, onDiskDir: folder } : x)) }));
            effectiveSession = { ...effectiveSession, onDiskDir: folder };
          }
          await appendTurn(getFileSink(), "sessions/" + effectiveSession.onDiskDir, effectiveSession, {
            turn: { id: turnId, sharedPrompt: outcome.text, customs: {} },
            prompts: [],
            results: [{ targetId: msgId, text: outcome.text, usage: outcome.usage ?? null }],
            status: { [msgId]: "done" },
            errors: {},
            createdAt: Date.now(),
          });
        } catch { sidecar = sidecar ? sidecar + " ؛ حُفظت الخلاصة محليًا وفشل أرشفتها على القرص" : "حُفظت الخلاصة محليًا وفشل أرشفتها على القرص"; }
      }
      if (sidecar) {
        const warned: ChatMessage = { ...finalMsg, sidecarWarning: sidecar };
        // [-المهمة 5] كتابة التحذير نفسها معزولة: فشلها لا يعيد تحويل الصف الناجح إلى خطأ
        try {
          await appendMessage(warned);
          if (!stale) upsertMessagesLocal([warned]);
        } catch { /* الصف الناجح في Dexie سليم — يكفي توست التحذير */ }
        if (!stale) toast.warning(sidecar);
      }
    } catch (e) {
      // [دور إصلاح مأذون — بند 3] كما في حارس persistTurn: toast عربي وإنهاء بطاقة الخلاصة
      // بوضع خطأ في الطبقتين (المخزن الحي فورًا، وDexie بأفضل جهد) لا رفض وعد معلق مع «يكتب…» أبديًا.
      const message = e instanceof Error ? e.message : String(e);
      // [-المهمة 5] حرس الجلسة: فشل متأخر بعد الانتقال لجلسة أخرى لا يلمس المخزن الحي الجديد
      const staleNow = useSessionsStore.getState().currentId !== session.id;
      if (!staleNow) toast.error(message);
      // مهما كان مصدر الرمي: تنظيف مؤقت نقاط الحفظ ولا نص فارغ يُكتب فوق محتوى محفوظ
      try { await settleStream(); } catch { clearInterval(streamTimer); }
      if (msgId && placeholderWritten && !staleNow) {
        const partial = accum;
        patchMessage(msgId, { status: "error", error: message });
        try { await appendMessage({ id: msgId, sessionId: session.id, turnId, createdAt: synthCreatedAt, role: "assistant", kind: "synthesis", text: partial, providerId: primary.providerId, modelId: primary.modelId, status: "error", error: message }); } catch { /* الطبقة التخزينية معطلة — تكفي الحالة الحية */ }
      }
    } finally { extractingRef.current = false; }
  }

  // [المهمة 4] التبديل يُثبت صريحًا في Dexie (updateSession) وفي الحالة الحية معًا —
  // كلا الوضعين يُحفظ باسمه حتى لا يصبح stateless ضمنيًا عند إعادة فتح الجلسة.
  async function onToggleContextMode(next: ContextMode): Promise<void> {
    await updateSession(session.id, { contextMode: next });
    useSessionsStore.setState((s) => ({ sessions: s.sessions.map((x) => (x.id === session.id ? { ...x, contextMode: next } : x)) }));
  }

  async function onToggleLayout(): Promise<void> {
    const next = session.layoutMode === "vertical" ? "horizontal" : "vertical";
    await updateSession(session.id, { layoutMode: next });
    useSessionsStore.setState((s) => ({ sessions: s.sessions.map((x) => (x.id === session.id ? { ...x, layoutMode: next } : x)) }));
  }

  if (targets.length === 0 && messages.length === 0) {
    return (
      <main className="flex-1 flex flex-col h-full min-w-0">
        <div className="flex-1 grid place-items-center text-sura-muted text-sm">أضف نماذج من (+) ثم اكتب سؤالك.</div>
        <Composer sessionId={session.id} onSend={() => void doSend()} onStop={() => {}} onExtractSummary={() => void extractSummary()} sending={sending} sessionTokens={sessionTokens} contextLimit={null} contextMode={contextMode} onContextModeChange={(next) => void onToggleContextMode(next)} />
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col h-full min-w-0">
      <div className="flex-1 overflow-y-auto p-4 space-y-4" dir="rtl">
        {turns.map(([turnId, t]) => (
          <TurnView key={turnId} prompts={t.prompts} results={t.results} layout={session.layoutMode}
            customPrompts={customPrompts} onToggleLayout={() => void onToggleLayout()}
            onStop={(tid) => { stopped.current.add(tid); aborts.current.get(tid)?.abort(new Error("ألغي بواسطة المستخدم")); patchMessageByTarget(tid, "stopped"); }}
            onRetry={(tid) => {
              // [دور إصلاح مأذون — بند 1] كان البحث في turns[last] حصريًا: بعد أول خلاصة تصبح
              // الأخيرة تمريرة syn- بلا targetId فتصمت أزرار الإعادة في تمريرة المصدر. الخيار
              // الأنظف: البحث عن التمريرة الحاوية للهدف نفسه (الأحدث أولًا) مهما كان موضعها.
              const entry = [...turns].reverse().find(([, t]) => t.results.some((r) => r.targetId === tid));
              if (!entry) return;
              const turn = entry[1];
              const m = turn.results.find((r) => r.targetId === tid);
              if (!m) return;
              // [انحراف موثق 7/8 عن كود الخطة] إعادة المحاولة كما في الخطة تبني تمرّة بأسئلة فارغة
              // فيُسقط الهدف (buildTurnTargets) وتولّد رسالة جديدة فتتضاعف البطاقات؛ هنا نعيد
              // بناء السؤال الموحد/المخصص من رسائل تمريرة الهدف ونعيد استخدام معرف النتيجة.
              const sharedMsg = [...turn.prompts].reverse().find((p) => p.promptKind === "shared");
              const customMsg = [...turn.prompts].reverse().find((p) => p.promptKind === "custom" && p.targetId === tid);
              void persistTurn({ id: m.turnId, sharedPrompt: sharedMsg?.text ?? null, customs: customMsg ? { [tid]: customMsg.text } : {} }, tid, [m], { [tid]: m.id });
            }} />
        ))}
        {turns.length === 0 && <p className="text-sura-muted text-sm">لا رسائل بعد.</p>}
      </div>
      <Composer sessionId={session.id} onSend={() => void doSend()} onStop={() => { for (const [tid, a] of aborts.current) { stopped.current.add(tid); a.abort(new Error("ألغي بواسطة المستخدم")); } }}
        onExtractSummary={() => void extractSummary()} sending={sending}
        sessionTokens={sessionTokens}
        contextLimit={contextLimit}
        contextMode={contextMode}
        onContextModeChange={(next) => void onToggleContextMode(next)} />
    </main>
  );
}

function patchMessageByTarget(targetId: string, status: ChatMessage["status"]): void {
  const s = useSessionsStore.getState();
  const m = [...s.messages].reverse().find((x) => x.targetId === targetId && x.role === "assistant");
  if (m) s.patchMessage(m.id, { status });
}
