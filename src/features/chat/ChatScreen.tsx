import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Composer } from "./Composer";
import { TurnView } from "./TurnView";
import { useSessionsStore } from "@/state/sessionsStore";
import { useComposerStore, type ComposerTarget } from "@/state/composerStore";
import { useSettingsStore } from "@/state/settingsStore";
import { estimateSessionTokens } from "@/lib/tokens/estimate";
import { getProvider } from "@/lib/providers/registry";
import { sendTurn } from "@/lib/chat/chatController";
import { dispatchTurn } from "@/lib/chat/dispatch";
import { buildSummaryPrompt } from "@/lib/chat/synthesis";
import { newId } from "@/lib/id";
import { appendMessage, recordUsage, updateSession } from "@/lib/db/repos";
import { getFileSink, isFilePersistActive } from "@/lib/markdown/sink";
import { appendTurn, sessionFolderName } from "@/lib/markdown/writer";
import { ar } from "@/i18n/ar";
import type { ChatMessage, SessionMeta, Turn } from "@/types";

export function ChatScreen({ session }: { session: SessionMeta }) {
  const { messages, patchMessage, upsertMessagesLocal, appendMessageLocal } = useSessionsStore();
  const { targets, syncMode, sharedPrompt, customs } = useComposerStore();
  const settings = useSettingsStore();
  const [sending, setSending] = useState(false);
  const aborts = useRef(new Map<string, AbortController>());
  // أهداف أوقفها المستخدم في التمرّة الجارية: نتيجة الإلغاء تصلف خطأً من dispatch
  // لكن البطاقة تبقى «أُوقف» ولا تتحول إلى خطأ ولا تُطلق تنبيهًا.
  const stopped = useRef(new Set<string>());
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
          session: effectiveSession, turn: turnForTargets, targets: signalTargets.map((t: ComposerTarget) => ({ targetId: t.targetId, providerId: t.providerId, modelId: t.modelId })),
          syncMode: retryTargetId ? false : syncMode,
          apiKeyFor: (pid) => settings.providerKeys[pid] ?? "",
          sessionHeaderFor: (pid) => (pid === "opencodego" ? { "x-opencode-session": session.id } : undefined),
          externalSignalFor: (tid) => { const ac = new AbortController(); aborts.current.set(tid, ac); return ac.signal; },
          timeoutMs: settings.timeoutMs,
          assistantIds,
        },
        {
          // [انحراف موثق 6/8 عن كود الخطة] الرجوع إلى حالة المخزن الحية بدل مصفوفة messages
          // المقفولة في الإغلاق: كود الخطة يجد آخر رسالة في اللقطة القديمة فيسقط دلتا كل
          // الأهداف إلا الأخيرة، ويجمّع نص إعادة المحاولة من نص قديم بدل النص الحي.
          onDelta: (tid, chunk) => {
            const live = useSessionsStore.getState().messages;
            const m = baseResults?.find((x) => x.targetId === tid) ?? [...live].reverse().find((x) => x.targetId === tid && x.role === "assistant");
            if (!m) return;
            const cur = live.find((x) => x.id === m.id) ?? m;
            patchMessage(m.id, { text: cur.text + chunk, status: "streaming" });
          },
          onStatus: (tid, st, err) => {
            const list = baseResults ?? useSessionsStore.getState().messages;
            const m = [...list].reverse().find((x) => x.targetId === tid && x.role === "assistant");
            if (m) {
              const userStopped = stopped.current.has(tid) && st === "error";
              patchMessage(m.id, { status: userStopped ? "stopped" : st, error: err });
            }
            if (st === "error" && err && !stopped.current.has(tid)) toast.error(err);
          },
          onDropped: (ids) => { if (ids.length) toast.warning(ar.droppedTargets + " (" + ids.length + ")"); },
          onAppended: (m) => upsertMessagesLocal([m]),
        },
      );
    } catch (e) {
      // حارس الإرسال بلا سؤال (تحفظ تنفيذي موجّه لهذه المهمة من مراجعة المهمة 4):
      // buildTurnTargets يرمي رسالة عربية موجّهة للمستخدم — نعرضها بدل رفض وعد صامت.
      toast.error(e instanceof Error ? e.message : String(e));
    } finally { setSending(false); aborts.current.clear(); stopped.current.clear(); }
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
    extractingRef.current = true;
    try {
      const prompt = buildSummaryPrompt(last[0], last[1].results);
      await appendMessageLocal({ id: newId("m"), sessionId: session.id, turnId, createdAt: Date.now(), role: "user", kind: "prompt", text: "طلب خلاصة من النموذج الأساسي", promptKind: "shared", status: "done" });
      await appendMessageLocal({ id: msgId, sessionId: session.id, turnId, createdAt: synthCreatedAt, role: "assistant", kind: "synthesis", text: "", providerId: primary.providerId, modelId: primary.modelId, status: "streaming" });
      placeholderWritten = true;
      const outcome = (await dispatchTurn({ sessionId: session.id, turnId, prompts: [{ targetId: msgId, providerId: primary.providerId, modelId: primary.modelId, text: prompt, hasShared: true, hasCustom: false }], apiKeyFor: (pid) => settings.providerKeys[pid] ?? "", sessionHeaderFor: (pid) => (pid === "opencodego" ? { "x-opencode-session": session.id } : undefined), timeoutMs: settings.timeoutMs }))[0];
      // [دور إصلاح مأذون — انحراف معلن عن كود الخطة بأمر منسق المهمة 13] patchMessage كان يحدّث المخزن
      // الحي فقط فيبقى صف Dexie فارغًا بـ streaming عند إعادة فتح الجلسة. مسار المهمة 11 نفسه (emit):
      // appendMessage (put بالمفتاح نفسه يستبدل صف البث) + upsert محلي. الفشل أيضًا يُثبت بحالته.
      const finalMsg: ChatMessage = { id: msgId, sessionId: session.id, turnId, createdAt: synthCreatedAt, role: "assistant", kind: "synthesis", text: outcome.text, providerId: primary.providerId, modelId: primary.modelId, status: outcome.ok ? "done" : "error", error: outcome.error, usage: outcome.usage };
      await appendMessage(finalMsg);
      upsertMessagesLocal([finalMsg]);
      if (!outcome.ok) toast.error(outcome.error ?? "فشل");
      // [دور إصلاح مأذون — بند 3 من دور الإصلاح الثاني] تصحيح لقرار منسق سابق («بلا recordUsage»):
      // النداء حقيقي للموديل الأساسي (برهان اختبار 401 في هذه المواصفة) — يُسجل حد استهلاك بمعرف
      // تمريرة الخلاصة (usage من outcome؛ أصفار وحالة error عند الفشل) بنمط مسار §6 نفسه.
      await recordUsage({ id: newId("u"), sessionId: session.id, turnId, ts: Date.now(), providerId: primary.providerId, modelId: primary.modelId, inputTokens: outcome.usage?.inputTokens ?? 0, outputTokens: outcome.usage?.outputTokens ?? 0, cachedInputTokens: outcome.usage?.cachedInputTokens ?? 0, costUSD: outcome.usage?.costUSD ?? null, toolCalls: 0, durationMs: outcome.ms, status: outcome.ok ? "ok" : "error" });
      // [دور إصلاح مأذون — بندا 1/2 من دور الإصلاح الثاني] أرشفة المحتوى لا الشاهد: sharedPrompt =
      // نص الخلاصة الفعلي (اقتباس مقروء بالبشر) وresults بمدخل النص حتى يعيد parser بناء رسالة
      // الخلاصة بنصها عند فقدان القاعدة. الأرشفة معزولة بـ try/catch خاص: فشلها لا يمس صف الخلاصة
      // الناجح في Dexie إطلاقًا (درس (أ)-5: put بالإفراغ كان يمحو النص) — تكفي رسالة تحذير.
      if (outcome.ok && isFilePersistActive()) {
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
        } catch {
          toast.warning("حُفظت الخلاصة محليًا وفشل أرشفتها على القرص");
        }
      }
    } catch (e) {
      // [دور إصلاح مأذون — بند 3] كما في حارس persistTurn: toast عربي وإنهاء بطاقة الخلاصة
      // بوضع خطأ في الطبقتين (المخزن الحي فورًا، وDexie بأفضل جهد) لا رفض وعد معلق مع «يكتب…» أبديًا.
      const message = e instanceof Error ? e.message : String(e);
      toast.error(message);
      if (msgId && placeholderWritten) {
        patchMessage(msgId, { status: "error", error: message });
        try { await appendMessage({ id: msgId, sessionId: session.id, turnId, createdAt: synthCreatedAt, role: "assistant", kind: "synthesis", text: "", providerId: primary.providerId, modelId: primary.modelId, status: "error", error: message }); } catch { /* الطبقة التخزينية معطلة — تكفي الحالة الحية */ }
      }
    } finally { extractingRef.current = false; }
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
        <Composer onSend={() => void doSend()} onStop={() => {}} onExtractSummary={() => void extractSummary()} sending={sending} sessionTokens={sessionTokens} contextLimit={128000} />
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
      <Composer onSend={() => void doSend()} onStop={() => { for (const [tid, a] of aborts.current) { stopped.current.add(tid); a.abort(new Error("ألغي بواسطة المستخدم")); } }}
        onExtractSummary={() => void extractSummary()} sending={sending}
        sessionTokens={sessionTokens}
        contextLimit={getProvider(targets[0]?.providerId ?? "openrouter").staticModels.find((m) => m.id === targets[0]?.modelId)?.contextLength ?? 128000} />
    </main>
  );
}

function patchMessageByTarget(targetId: string, status: ChatMessage["status"]): void {
  const s = useSessionsStore.getState();
  const m = [...s.messages].reverse().find((x) => x.targetId === targetId && x.role === "assistant");
  if (m) s.patchMessage(m.id, { status });
}
