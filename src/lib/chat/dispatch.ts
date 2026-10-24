import { streamText, isStepCount, InvalidResponseDataError } from "ai";
import { uiText } from "@/i18n";
import type { LanguageModelUsage, ModelMessage } from "ai";
import { buildLanguageModel, computeCost, getProvider } from "@/lib/providers/registry";
import { buildContextMessages } from "./context";
import { resolveContextLimit } from "./contextLimit";
import { getTransportFetch } from "@/lib/transport/transport";
import { mapProviderError } from "@/lib/providers/keyTest";
import { KeyedError } from "@/lib/errors/keyedError";
import { useSettingsStore } from "@/state/settingsStore";
import type { BuiltPrompt, ContextMode, ChatMessage, ModelInfo, ProviderId, TurnStatus, Usage } from "@/types";

/** أقصى عدد خطوات عند تفعيل الأدوات: نداء الأداة ثم إجابة عليها (وأدوار تصحيح بينهما). */
const TOOL_STEP_BUDGET = 5;

/** [T2.7/LV-02] نافذة الصمت التي تدخل بعدها البطاقة حالة «يفكّر» حين يبلّغ المزوّد عن رموز تفكير ولا يبثّها. */
const REASONING_SILENCE_MS = 1500;

/** تصنيف صريح لنتيجة النداء: توقف المستخدم ليس خطأ، والغياب الحميد لfinish يبقى متوافقًا فقط عند نهاية بث سليمة */
export type DispatchStatus = "done" | "stopped" | "error" | "truncated";

/** أسباب النهاية التي تعني دورًا مكتملًا. (ai FinishReason = 'stop'|'length'|'tool-calls'|'content-filter'|'error'|'other') */
const SUCCESS_FINISH_REASONS: readonly string[] = ["stop", "length", "tool-calls"];

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
  multiStepTools?: boolean;
  historyFor(targetId: string): readonly ChatMessage[];
  modelInfoFor(targetId: string): ModelInfo;
  onUpdate?(operationId: string, targetId: string, chunk: string): void;
  /** [T2.7/LV-02] تفعيل/إلغاء حالة التفكير؛ نصّ التفكير لا يُمرَّر لأنه لا يُلحق بالجواب أبدًا. */
  onReasoning?(operationId: string, targetId: string, active: boolean): void;
  externalSignalFor?(targetId: string): AbortSignal | undefined;
  onStatus?(operationId: string, targetId: string, status: TurnStatus, error?: string): void;
  onToolExecutionStart?(targetId: string, toolName: string): void;
  onToolExecutionEnd?(targetId: string, toolName: string): void;
  onToolExecutionError?(targetId: string, toolName: string, error: string): void;
}

/**
 * [T2.4/NL-01] يحوّل استهلاك SDK إلى عقد الاستهلاك المحلي. `inputTokens` هو إجمالي رموز الدخل
 * (asLanguageModelUsage يقرأ usage.inputTokens.total)، فيشتق computeCost غير المُخزَّن بالطرح ولا
 * حاجة لحقل noCacheTokens منفصل. الوحدات الجزئية لا تعيش إلا في inputTokenDetails
 * (ai@7: LanguageModelUsage لا يملك cachedInputTokens ولا cacheWriteInputTokens).
 * دالة نقية مقيسة مباشرة لأن كلا المزوّدين يثبّت cacheWrite: void 0 فلا يصل عدد الكتابة عبر المزوّد.
 */
export function toUsage(u: LanguageModelUsage, costModel: Pick<ModelInfo, "pricing"> | undefined): Usage {
  const inputTokens = u.inputTokens ?? 0;
  const outputTokens = u.outputTokens ?? 0;
  const cachedInputTokens = u.inputTokenDetails?.cacheReadTokens ?? 0;
  const cacheWriteInputTokens = u.inputTokenDetails?.cacheWriteTokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheWriteInputTokens,
    costUSD: costModel ? computeCost({ inputTokens, outputTokens, cachedInputTokens, cacheWriteInputTokens }, costModel) : null,
  };
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
      clearTimeout(silenceTimer);
      ac.signal.removeEventListener("abort", onAbort);
      externalSignal?.removeEventListener("abort", externalListener);
    };
    const status = args.onStatus ? (s: TurnStatus, error?: string) => args.onStatus?.(args.operationId, p.targetId, s, error) : undefined;
    // [تصحيح المهمة 5] سبب المهلة كائن ملتقط واحد: التصنيف بمطابقة الهوية (r === timeoutReason) بدل regex الرسالة
    const timeoutReason = new KeyedError("errors.callTimeout");
    const timer = setTimeout(() => ac.abort(timeoutReason), timeout);
    let rawError: unknown;
    // [المهمة 5] المراكم مشترك وخارج السباق: الإيقاف/المهلة/فشل المزود كلها تحفظ النص الجزئي
    const acc: Accumulator = { text: "" };
    // [T7.4] آخر استهلاك أبلغ عنه المزود في جزء finish-step، ونموذج تسعيره. يُستردان في مساري
    // التوقف والخطأ: إلغاء أثناء خطوة لا يُنتج جزءًا جديدًا (قياس ai@7.0.92)، لكن خطوة اكتملت
    // قبل الإلغاء تبلّغ باستهلاكها، فحفظها أصدق من تسجيل صفر.
    let lastUsage: LanguageModelUsage | undefined;
    let costModelForUsage: Pick<ModelInfo, "pricing"> | undefined;
    const salvageUsage = (): { usage?: Usage } =>
      lastUsage === undefined ? {} : { usage: toUsage(lastUsage, costModelForUsage) };
    // [T2.7/LV-02] حالة «يفكّر» لكل هدف، بانتقالات حدّية فقط: تُضبط من دلتات التفكير،
    // أو من صمتٍ يتجاوز النافذة (مزوّد يبلّغ عن رموز تفكير ولا يبثّها — step-5).
    // نصّ التفكير لا يدخل acc.text ولا onUpdate: الحالة وحدها تُنشر.
    let reasoningActive = false;
    let silenceTimer: ReturnType<typeof setTimeout> | undefined;
    const setReasoning = (active: boolean): void => {
      if (reasoningActive === active) return;
      reasoningActive = active;
      args.onReasoning?.(args.operationId, p.targetId, active);
    };
    // [تصحيح المهمة 5] بوابة الحسم: يجبود توقف تراكم النص وonUpdate بعد إغلاق السباق
    let terminal = false;
    let onAbort: () => void = () => {};
    // [إصلاح موثق على كود الخطة — 1/3] مهلة/إيقاف خارجي فوق نقل لا يرصد الإشارة:
    // fetch وهمية (وعد لا يُحسم أبدًا) لا ترفض عند abort فيتعلق البث للأبد (الدليل: مهلة vitest 5009ms).
    // السباق على حدث الإشارة يضمن عودة النتيجة فور الإلغاء؛ ومع نقل حقيقي يبقى abort(reject) ساري الأثر.
    const abortedOutcome = new Promise<DispatchOutcome>((resolve) => {
      onAbort = () => {
        const r: unknown = ac.signal.reason;
        // [المهمة 5/تصحيح] المهلة تصنف error بمطابقة هوية السبب الملتقط؛ إلغاء المستخدم الخارجي يبقى stopped
        // — وكلاهما يُثري النتيجة بالنص المتراكم خارج السباق ويجود البوابة قبل الوصول إلى resolve
        const isTimeout = r === timeoutReason;
        terminal = true;
        const reason = r instanceof Error ? r : new Error(typeof r === "string" && r ? r : uiText.t("errors.callCancelled"));
        // [T7.4] قياس مباشر على ai@7.0.92: عند الإلغاء لا يصل أي جزء finish-step إضافي ووعده
        // result.usage يبقى معلّقًا (PENDING) فلا يجوز انتظاره. ما وصل قبل الإلغاء يُسترد هنا.
        resolve({
          targetId: p.targetId, operationId: args.operationId,
          status: isTimeout ? "error" : "stopped",
          text: acc.text,
          ...(isTimeout ? { error: mapProviderError(reason) } : {}),
          ...salvageUsage(),
          ms: Date.now() - t0,
        });
      };
      ac.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      // [L5] status?.("streaming") moved inside try block so cleanup runs if it throws.
      status?.("streaming");
      const modelInfo = args.modelInfoFor(p.targetId);
      const history = args.historyFor(p.targetId).filter((row) => row.sessionId === args.sessionId);
      // [صرامة مأذونة ضمن حقن المهمة 4] buildContextMessages يقيم الحد الآمن (منها 0.8) قبل أي اتصال
      // — إخلاء سبيلها هنا يعيد فشل DispatchOutcome عاديًا من كتلة catch دون أي نداء شبكة.
      const modelMessages: ModelMessage[] = buildContextMessages(
        history, p.text, args.contextMode,
        // [T2.5/NL-02] الحد من مصدره الواحد: المقياس يقرأ الرقم نفسه فلا يقع رفض بلا حركة مقياس.
        resolveContextLimit(modelInfo).limit,
      );
      const flow = (async (): Promise<DispatchOutcome> => {
        try {
          const model = buildLanguageModel(p.providerId as ProviderId, args.apiKeyFor(p.providerId as ProviderId), p.modelId, args.fetchImpl ?? getTransportFetch(), args.sessionHeaderFor(p.providerId as ProviderId));
          // [إصلاح موثق على كود الخطة — 2/3] التقاط الخطأ الخام عبر onError:
          // عند فشل doStream (مثل 401) يغلق ai@7 البث رشيقًا (بلا رمٍ من textStream) ويرفض result.usage
          // بـ NoOutputGeneratedError رسالته "No output generated..." تحوي "generated" فتطابق /rate/ خاطئًا
          // في mapProviderError — الخطأ الخام (APICallError بـ statusCode) هو مصدر الترجمة الصحيحة.
          const ragSettings = useSettingsStore.getState().ragSettings;
          // [المهمة 4 + NM-01] قرار واحد لا قراران: الأداة تُعرض إن — وفقط إن — كان في
          // الميزانية خطوة تستهلك نتيجتها. كان التسجيل دائمًا وstopWhen منفصلًا عنه، فيُعرض
          // search_documents مع isStepCount(1): يستدعيه النموذج، تُنفَّذ الأداة، ثم تتوقف
          // الحلقة قبل إعادة نتيجتها، فيُوسم الدور done بنص تمهيدي فقط.
          const stepBudget = args.multiStepTools ? TOOL_STEP_BUDGET : 1;
          // الاستيراد الديناميكي (LV-09) لا يقع إلا عند الحاجة: مع خطوة واحدة لا تُبنى الأداة
          // ولا تُحمَّل وحدة RAG أصلًا.
          const tools = stepBudget > 1
            ? { search_documents: (await import("@/lib/rag/tool")).createSearchDocumentsTool({ settings: ragSettings }) }
            : undefined;
          // [T2.3/NM-03] الكلفة من النموذج المحلول لا من السجل الثابت وحده: النموذج المضاف من
          // كتالوج المزود المباشر يحمل سعره المنشور في modelInfo، وstaticModels لا تعرفه فيبقى
          // costUSD null رغم توفّر السعر. السجل الثابت احتياطي حين يخلو الوصف المحلول من سعر.
          // [T7.4] ويُحسب قبل البث ليخدم استرداد استهلاك خطوة اكتملت بعد إلغاء الدور أيضًا.
          const staticInfo = getProvider(p.providerId as ProviderId).staticModels.find((m) => m.id === p.modelId);
          costModelForUsage = modelInfo.pricing ? modelInfo : staticInfo;
          const result = streamText({
            model, messages: modelMessages, abortSignal: ac.signal, maxRetries: 0,
            ...(tools ? { tools } : {}),
            stopWhen: isStepCount(stepBudget),
            onToolExecutionStart: ({ toolCall }) => { args.onToolExecutionStart?.(p.targetId, toolCall.toolName); },
            onToolExecutionEnd: ({ toolCall, toolOutput }) => {
              // يغلف AI SDK خطأ الأداة المرمي كـ { type: "tool-error", error } — نرصد خاصية error
              // لنطلق onToolExecutionError قبل نداء النهاية العادي.
              if (toolOutput != null && typeof toolOutput === "object" && "error" in toolOutput) {
                args.onToolExecutionError?.(p.targetId, toolCall.toolName, String((toolOutput as { error: unknown }).error));
              }
              args.onToolExecutionEnd?.(p.targetId, toolCall.toolName);
            },
            onError: ({ error }) => { if (rawError === undefined) rawError = error; },
          });
          // [T2.7/LV-02] fullStream بدل textStream: textStream يرشّح text-delta فقط فيُسقط التفكير كليًا.
          // قياس مباشر على المزوّد + ai@7.0.92: دلتات reasoning_content/reasoning تصل
          // reasoning-start/reasoning-delta/reasoning-end في fullStream، وأول دلتا نص تُطلق reasoning-end.
          silenceTimer = setTimeout(() => setReasoning(true), REASONING_SILENCE_MS);
          for await (const part of result.fullStream) {
            // [تصحيح المهمة 5] ما بعد السباق: نقل يتجاهل abort لا يجبود المراكم ولا النداءات
            if (terminal) break;
            if (part.type === "text-delta") {
              clearTimeout(silenceTimer);
              silenceTimer = undefined;
              setReasoning(false);
              acc.text += part.text;
              args.onUpdate?.(args.operationId, p.targetId, part.text);
            } else if (part.type === "reasoning-start" || part.type === "reasoning-delta") {
              clearTimeout(silenceTimer);
              silenceTimer = undefined;
              setReasoning(true);
            } else if (part.type === "reasoning-end") {
              setReasoning(false);
            } else if (part.type === "finish-step") {
              // [T7.4] استهلاك خطوة اكتملت: يصل قبل نهاية الدورة فيبقى قابلًا للاسترداد لو
              // أُلغيت الخطوة التالية (تدفق أدوات متعدد الخطوات).
              lastUsage = part.usage;
            } else if (part.type === "error" && rawError === undefined) {
              // fullStream لا يرمي أخطاء منتصف البث: يسلّمها كجزء error ثم يواصل إلى finish.
              // إهمالها كان سيوسم انقطاعًا مزودًا بـ done (نكوص NM-02)؛ الحسم يبقى في فحص rawError أدناه.
              rawError = part.error;
            }
          }
          // [T2.2/NM-02] تصنيف النهاية من حالة البث لا من نص رسالة SDK. قياس مباشر على ai@7.0.92
          // (مُهيّئان متطابقان إلا في سبب النهاية): البث السليم يُحلّ إلى finishReason 'stop'/'length'/
          // 'tool-calls' مع usage صحيح، والبث الذي ينتهي جسمه بلا سبب نهاية يُحلّ إلى
          // finishReason === "error" مع InvalidResponseDataError — والاثنان لا يفترقان في نصّ الرسالة.
          // كان الفحص القديم يستثني تلك الرسالة بنمط نصي، فيمرّ الانقطاع موسومًا done بنص تمهيدي.
          const fr = (await result.finishReason) as unknown;
          const finishReason: string | undefined = typeof fr === "string" ? fr : undefined;
          const cleanEnd = finishReason !== undefined && SUCCESS_FINISH_REASONS.includes(finishReason);
          // "error" هنا ليس خطأ مزود: هو تصنيف SDK لانتهاء جسم الاستجابة بلا سبب نهاية (انقطاع نقل).
          const truncatedEnd = finishReason === "error";
          // خطأ خام حقيقي يُرفع فورًا قبل أي await آخر (نافذة ابتلاع أخطاء منتصف البث تبقى مغلقة).
          // يُستثنى فقط الخطأ المطابق لحالة الانقطاع نفسها: لا نبتلع خطأ نقل حقيقيًا أبدًا.
          if (rawError !== undefined && !(truncatedEnd && rawError instanceof InvalidResponseDataError)) throw rawError;
          if (!cleanEnd && !truncatedEnd) throw new KeyedError("errors.unknownFinishReason", { reason: String(finishReason ?? "") });
          const u = await result.usage;
          const usage = toUsage(u, costModelForUsage);
          // النص الجزئي محفوظ في الحالتين؛ الفارق أن الانقطاع لا يُوسم done.
          // finishReason لا يحمل قيمة "error" (تصنيف SDK لا سبب مزود) فلا يُنشر في النتيجة.
          if (truncatedEnd) {
            return { targetId: p.targetId, operationId: args.operationId, status: "truncated" as const, text: acc.text, usage, ms: Date.now() - t0 };
          }
          return { targetId: p.targetId, operationId: args.operationId, status: "done" as const, text: acc.text, usage, ms: Date.now() - t0, ...(finishReason !== undefined ? { finishReason } : {}) };
        } catch (e) {
          const source = rawError !== undefined ? rawError : e;
          return { targetId: p.targetId, operationId: args.operationId, status: "error" as const, text: acc.text, error: ac.signal.aborted && !ac.signal.reason ? uiText.t("errors.callCancelled") : mapProviderError(source), ...salvageUsage(), ms: Date.now() - t0 };
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
