import { streamText } from "ai";
import { buildLanguageModel, computeCost, getProvider } from "@/lib/providers/registry";
import { getTransportFetch } from "@/lib/transport/transport";
import { mapProviderError } from "@/lib/providers/keyTest";
import type { BuiltPrompt, ProviderId, Usage } from "@/types";

export interface DispatchOutcome { targetId: string; ok: boolean; text: string; error?: string; usage?: Usage; ms: number; }

export interface DispatchArgs {
  sessionId: string; turnId: string;
  prompts: readonly BuiltPrompt[];
  apiKeyFor(providerId: ProviderId): string;
  sessionHeaderFor(providerId: ProviderId): Record<string, string> | undefined;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  onUpdate?(targetId: string, chunk: string): void;
  externalSignalFor?(targetId: string): AbortSignal | undefined;
}

export async function dispatchTurn(args: DispatchArgs): Promise<DispatchOutcome[]> {
  const timeout = args.timeoutMs ?? 120_000;
  const results = await Promise.all(args.prompts.map(async (p): Promise<DispatchOutcome> => {
    const t0 = Date.now();
    const ac = new AbortController();
    args.externalSignalFor?.(p.targetId)?.addEventListener("abort", () => ac.abort(new Error("أُلغي بواسطة المستخدم")));
    const timer = setTimeout(() => ac.abort(new Error("انتهت مهلة النداء")), timeout);
    let rawError: unknown;
    let onAbort: () => void = () => {};
    // [إصلاح موثق على كود الخطة — 2/3] مهلة/إيقاف خارجي فوق نقل لا يرصد الإشارة:
    // fetch وهمية (وعد لا يُحسم أبدًا) لا ترفض عند abort فيتعلق البث للأبد (الدليل: مهلة vitest 5009ms).
    // السباق على حدث الإشارة يضمن عودة النتيجة فور الإلغاء؛ ومع نقل حقيقي يبقى abort(reject) ساري الأثر.
    const abortedOutcome = new Promise<DispatchOutcome>((resolve) => {
      onAbort = () => {
        const r: unknown = ac.signal.reason;
        const reason = r instanceof Error ? r : new Error(typeof r === "string" && r ? r : "ألغي النداء");
        resolve({ targetId: p.targetId, ok: false, text: "", error: mapProviderError(reason), ms: Date.now() - t0 });
      };
      ac.signal.addEventListener("abort", onAbort, { once: true });
    });
    const flow = (async (): Promise<DispatchOutcome> => {
      try {
        const model = buildLanguageModel(p.providerId as ProviderId, args.apiKeyFor(p.providerId as ProviderId), p.modelId, args.fetchImpl ?? getTransportFetch(), args.sessionHeaderFor(p.providerId as ProviderId));
        // [إصلاح موثق على كود الخطة — 1/3] التقاط الخطأ الخام عبر onError:
        // عند فشل doStream (مثل 401) يغلق ai@7 البث رشيقًا (بلا رمٍ من textStream) ويرفض result.usage
        // بـ NoOutputGeneratedError رسالته "No output generated..." تحوي "generated" فتطابق /rate/ خاطئًا
        // في mapProviderError — الخطأ الخام (APICallError بـ statusCode) هو مصدر الترجمة الصحيحة.
        const result = streamText({ model, prompt: p.text, abortSignal: ac.signal, onError: ({ error }) => { if (rawError === undefined) rawError = error; } });
        let text = "";
        for await (const chunk of result.textStream) { text += chunk; args.onUpdate?.(p.targetId, chunk); }
        // [تحصين مأذون به — تحفظ (أ) من المهمة 8 المنفذ بأمر منسق المهمة 11] مع عدل موثق إجباري:
        // الصيغة الحرفية «if (rawError !== undefined) throw rawError» بعد حلقة الدلتا تكسر 3 اختبارات
        // معتمدة في dispatch.spec — ai@7 يطلق onError بخطأ حميد "Response stream ended without a
        // finish reason" مع نهاية بث سليمة وusage صحيح (الاختبارات هي المواصفة، درس 6/7/9/10).
        // نرفع الخطأ الخام فور الحلقة لإغلاق نافذة ابتلاع أخطاء منتصف البث، باستثناء ذلك البنين.
        const benignEnd = rawError instanceof Error && /ended without a finish reason/.test(rawError.message);
        if (rawError !== undefined && !benignEnd) throw rawError;
        const u = await result.usage;
        const info = getProvider(p.providerId as ProviderId).staticModels.find((m) => m.id === p.modelId);
        const usage: Usage = {
          inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0,
          // [إصلاح موثق على كود الخطة — 3/3] ai@7: LanguageModelUsage لا يملك cachedInputTokens؛
          // المكسورة في inputTokenDetails.cacheReadTokens (d.ts 320-341 + asLanguageModelUsage)
          // — u.cachedInputTokens خطأ نوعي وقيمته undefined دائمًا.
          cachedInputTokens: u.inputTokenDetails?.cacheReadTokens ?? 0,
          // computeCost يقتصر على Pick<Usage,"inputTokens"|"outputTokens">؛ تمرير cachedInputTokens
          // كائن حرفي بخاصية زائدة (TS2353) — حرفية الخطة المُزامَنة (296fbb5) بلا cachedInputTokens.
          costUSD: info ? computeCost({ inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0 }, info) : null,
        };
        return { targetId: p.targetId, ok: true, text, usage, ms: Date.now() - t0 };
      } catch (e) {
        const source = rawError !== undefined ? rawError : e;
        return { targetId: p.targetId, ok: false, text: "", error: ac.signal.aborted && !ac.signal.reason ? "أُلغي النداء" : mapProviderError(source), ms: Date.now() - t0 };
      } finally {
        clearTimeout(timer);
        ac.signal.removeEventListener("abort", onAbort);
      }
    })();
    return await Promise.race([flow, abortedOutcome]);
  }));
  return results;
}
