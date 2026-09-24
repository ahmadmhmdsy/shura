import { streamText } from "ai";
import type { ModelMessage } from "ai";
import { buildLanguageModel, computeCost, getProvider } from "@/lib/providers/registry";
import { buildContextMessages } from "./context";
import { getTransportFetch } from "@/lib/transport/transport";
import { mapProviderError } from "@/lib/providers/keyTest";
import type { BuiltPrompt, ContextMode, ChatMessage, ModelInfo, ProviderId, TurnStatus, Usage } from "@/types";

/** تصنيف صريح لنتيجة النداء: توقف المستخدم ليس خطأ، والغياب الحميد لfinish يبقى متوافقًا فقط عند نهاية بث سليمة */
export type DispatchStatus = "done" | "stopped" | "error";

export interface DispatchOutcome {
  targetId: string;
  operationId: string;
  status: DispatchStatus;
  text: string;
  error?: string;
  usage?: Usage;
  ms: number;
  finishReason?: string;
}

/** عامل تراكم النص المشترك: يبقى خارج سباق الإلغاء حتى يحتفظ الإيقاف/المهلة/الخطأ بالنص الجزئي */
interface Accumulator { text: string; }

export interface DispatchArgs {
  operationId: string;
  sessionId: string; turnId: string;
  prompts: readonly BuiltPrompt[];
  apiKeyFor(providerId: ProviderId): string;
  sessionHeaderFor(providerId: ProviderId): Record<string, string> | undefined;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  contextMode: ContextMode;
  historyFor(targetId: string): readonly ChatMessage[];
  modelInfoFor(targetId: string): ModelInfo;
  onUpdate?(operationId: string, targetId: string, chunk: string): void;
  externalSignalFor?(targetId: string): AbortSignal | undefined;
  onStatus?(operationId: string, targetId: string, status: TurnStatus, error?: string): void;
}

export async function dispatchTurn(args: DispatchArgs): Promise<DispatchOutcome[]> {
  const timeout = args.timeoutMs ?? 120_000;
  const results = await Promise.all(args.prompts.map(async (p): Promise<DispatchOutcome> => {
    const t0 = Date.now();
    const ac = new AbortController();
    // [سطر مأذون به إضافي — قرار منسق المهمة 11] تمرير سبب الإلغاء الخارجي بدل توليد رسالة خاصة
    // مشكولة كانت تُهدر سبب externalSignalFor («ألغي بواسطة المستخدم») وتُبطل مطابقة /ألغي/؛
    // المسار بلا سبب يبقى على الافتراضي في onAbort، ومسار المهلة (abort داخلي من المؤقت) كما هو.
    const externalSignal = args.externalSignalFor?.(p.targetId);
    // المستمع الخارجي مُسمّى ليُزال في cleanup عند كل مسار خروج (منها كتلة catch الخارجية)
    const externalListener = () => ac.abort(externalSignal!.reason);
    externalSignal?.addEventListener("abort", externalListener);
    // [إصلاح تسرب الموارد] تنظيف يُستدعى من finally الداخلية ومن finally الخارجية:
    // تجاوز السياق يعود من catch الخارجية قبل إنشاء flow لا يصل أبًا لـ finally الداخلية
    // فبقيت مهلة النداء ومستمع إلغاء الإشارة الداخلي والخارجي معلقة — كل مسارات الخروج تمر هنا.
    const cleanup = (): void => {
      clearTimeout(timer);
      ac.signal.removeEventListener("abort", onAbort);
      externalSignal?.removeEventListener("abort", externalListener);
    };
    const status = args.onStatus ? (s: TurnStatus, error?: string) => args.onStatus?.(args.operationId, p.targetId, s, error) : undefined;
    status?.("streaming");
    const timer = setTimeout(() => ac.abort(new Error("انتهت مهلة النداء")), timeout);
    let rawError: unknown;
    // [المهمة 5] المراكم مشترك وخارج السباق: الإيقاف/المهلة/فشل المزود كلها تحفظ النص الجزئي
    const acc: Accumulator = { text: "" };
    let onAbort: () => void = () => {};
    // [إصلاح موثق على كود الخطة — 1/3] مهلة/إيقاف خارجي فوق نقل لا يرصد الإشارة:
    // fetch وهمية (وعد لا يُحسم أبدًا) لا ترفض عند abort فيتعلق البث للأبد (الدليل: مهلة vitest 5009ms).
    // السباق على حدث الإشارة يضمن عودة النتيجة فور الإلغاء؛ ومع نقل حقيقي يبقى abort(reject) ساري الأثر.
    const abortedOutcome = new Promise<DispatchOutcome>((resolve) => {
      onAbort = () => {
        const r: unknown = ac.signal.reason;
        // [المهمة 5] المهلة (abort داخلي من المؤقت) تصنف error؛ إلغاء المستخدم الخارجي يبقى stopped
        // — وكلاهما يُثري النتيجة بالنص المتراكم خارج السباق
        const isTimeout = r instanceof Error && /انتهت مهلة/.test(r.message);
        const reason = r instanceof Error ? r : new Error(typeof r === "string" && r ? r : "ألغي النداء");
        resolve({
          targetId: p.targetId, operationId: args.operationId,
          status: isTimeout ? "error" : "stopped",
          text: acc.text,
          ...(isTimeout ? { error: mapProviderError(reason) } : {}),
          ms: Date.now() - t0,
        });
      };
      ac.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const modelInfo = args.modelInfoFor(p.targetId);
      const history = args.historyFor(p.targetId).filter((row) => row.sessionId === args.sessionId);
      // [صرامة مأذونة ضمن حقن المهمة 4] buildContextMessages يقيم الحد الآمن (منها 0.8) قبل أي اتصال
      // — إخلاء سبيلها هنا يعيد فشل DispatchOutcome عاديًا من كتلة catch دون أي نداء شبكة.
      const modelMessages: ModelMessage[] = buildContextMessages(
        history, p.text, args.contextMode,
        modelInfo.contextLength ?? 128000,
      );
      const flow = (async (): Promise<DispatchOutcome> => {
        try {
          const model = buildLanguageModel(p.providerId as ProviderId, args.apiKeyFor(p.providerId as ProviderId), p.modelId, args.fetchImpl ?? getTransportFetch(), args.sessionHeaderFor(p.providerId as ProviderId));
          // [إصلاح موثق على كود الخطة — 2/3] التقاط الخطأ الخام عبر onError:
          // عند فشل doStream (مثل 401) يغلق ai@7 البث رشيقًا (بلا رمٍ من textStream) ويرفض result.usage
          // بـ NoOutputGeneratedError رسالته "No output generated..." تحوي "generated" فتطابق /rate/ خاطئًا
          // في mapProviderError — الخطأ الخام (APICallError بـ statusCode) هو مصدر الترجمة الصحيحة.
          const result = streamText({ model, messages: modelMessages, abortSignal: ac.signal, onError: ({ error }) => { if (rawError === undefined) rawError = error; } });
          for await (const chunk of result.textStream) { acc.text += chunk; args.onUpdate?.(args.operationId, p.targetId, chunk); }
          // [تحصين مأذون به — تحفظ (أ) من المهمة 8 المنفذ بأمر منسق المهمة 11] مع عدل موثق إجباري:
          // الصيغة الحرفية «if (rawError !== undefined) throw rawError» بعد حلقة الدلتا تكسر 3 اختبارات
          // معتمدة في dispatch.spec — ai@7 يطلق onError بخطأ حميد "Response stream ended without a
          // finish reason" مع نهاية بث سليمة وusage صحيح (الاختبارات هي المواصفة، درس 6/7/9/10).
          // نرفع الخطأ الخام فور الحلقة لإغلاق نافذة ابتلاع أخطاء منتصف البث، باستثناء ذلك البنين.
          const benignEnd = rawError instanceof Error && /ended without a finish reason/.test(rawError.message);
          if (rawError !== undefined && !benignEnd) throw rawError;
          // [المهمة 5] تصنيف النهاية صريحًا: سبب نهاية غير حميد لا يُرحّح نجاحًا
          const finishReason = (await result.finishReason) as unknown;
          if (rawError === undefined && !benignEnd && (typeof finishReason !== "string" || !["stop", "length", "tool-calls", "unknown"].includes(finishReason))) {
            throw new Error("نهاية غير معروفة: " + String(finishReason));
          }
          const u = await result.usage;
          const info = getProvider(p.providerId as ProviderId).staticModels.find((m) => m.id === p.modelId);
          const usage: Usage = {
            inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0,
            // [إصلاح موثق على كود الخطة — 3/3] ai@7: LanguageModelUsage لا يملك cachedInputTokens؛
            // المكسورة في inputTokenDetails.cacheReadTokens — u.cachedInputTokens خطأ نوعي وقيمته undefined دائمًا.
            cachedInputTokens: u.inputTokenDetails?.cacheReadTokens ?? 0,
            // computeCost يقتصر على Pick<Usage,"inputTokens"|"outputTokens">؛ تمرير cachedInputTokens
            // كائن حرفي بخاصية زائدة (TS2353) — حرفية الخطة المُزامَنة (296fbb5) بلا cachedInputTokens.
            costUSD: info ? computeCost({ inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0 }, info) : null,
          };
          return { targetId: p.targetId, operationId: args.operationId, status: "done" as const, text: acc.text, usage, ms: Date.now() - t0, finishReason: String(finishReason) };
        } catch (e) {
          const source = rawError !== undefined ? rawError : e;
          return { targetId: p.targetId, operationId: args.operationId, status: "error" as const, text: acc.text, error: ac.signal.aborted && !ac.signal.reason ? "أُلغي النداء" : mapProviderError(source), ms: Date.now() - t0 };
        } finally {
          cleanup();
        }
      })();
      const outcome = await Promise.race([flow, abortedOutcome]);
      status?.(outcome.status, outcome.error);
      return outcome;
    } catch (e) {
      const outcome = flowlessOutcome(e, p.targetId, args.operationId, t0);
      status?.("error", outcome.error);
      return outcome;
    } finally {
      cleanup();
    }
  }));
  return results;
}

function flowlessOutcome(e: unknown, targetId: string, operationId: string, t0: number): DispatchOutcome {
  return { targetId, operationId, status: "error", text: "", error: mapProviderError(e), ms: Date.now() - t0 };
}
