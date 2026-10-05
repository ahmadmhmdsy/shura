import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import type { ModelInfo, ProviderConfig, ProviderId, Usage } from "@/types";

const staticPricing = (inP: number, outP: number) => ({ inputPerMTok: inP, outputPerMTok: outP });

const APP_REFERER = (import.meta.env?.VITE_APP_REFERER as string | undefined) ?? "http://localhost:5173";

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  openrouter: {
    id: "openrouter", label: "OpenRouter", browserDirect: true, kind: "openai-compatible",
    baseURL: "https://openrouter.ai/api/v1", modelsSource: "live",
    liveModelsUrl: "https://openrouter.ai/api/v1/models",
    keyCheckUrl: "https://openrouter.ai/api/v1/models", keyCheckAuth: "bearer",
    defaultHeaders: { "HTTP-Referer": APP_REFERER, "X-Title": "Shura" },
    staticModels: [
      { id: "openai/gpt-4o", label: "GPT-4o", contextLength: 128000, pricing: staticPricing(2.5, 10) },
      { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5", contextLength: 200000, pricing: staticPricing(3, 15) },
    ],
  },
  google: {
    id: "google", label: "Google Gemini", browserDirect: true, kind: "google",
    baseURL: "https://generativelanguage.googleapis.com/v1beta", modelsSource: "static",
    keyCheckUrl: "https://generativelanguage.googleapis.com/v1beta/models", keyCheckAuth: "query",
    staticModels: [
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", contextLength: 1048576, pricing: staticPricing(1.25, 10) },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", contextLength: 1048576, pricing: staticPricing(0.3, 2.5) },
    ],
  },
  minimax: {
    id: "minimax", label: "MiniMax", browserDirect: true, kind: "openai-compatible",
    baseURL: "https://api.minimax.io/v1", modelsSource: "static",
    keyCheckUrl: "https://api.minimax.io/v1/models", keyCheckAuth: "bearer",
    staticModels: [
      { id: "MiniMax-M2", label: "MiniMax M2", contextLength: 204800, pricing: staticPricing(0.3, 1.2) },
      { id: "MiniMax-Text-01", label: "MiniMax Text 01", contextLength: 1000192, pricing: staticPricing(0.2, 1.1) },
    ],
  },
  opencodego: {
    id: "opencodego", label: "OpenCode Go", browserDirect: false, kind: "openai-compatible",
    baseURL: "https://opencode.ai/zen/go/v1", modelsSource: "static",
    keyCheckUrl: "https://opencode.ai/zen/go/v1/models", keyCheckAuth: "bearer",
    sessionHeaderName: "x-opencode-session",
    staticModels: [
      { id: "glm-5.3", label: "GLM-5.3", pricing: staticPricing(0.6, 2.2) },
      { id: "kimi-k2.6", label: "Kimi K2.6", pricing: staticPricing(0.6, 2.5) },
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", pricing: staticPricing(0.1, 0.4) },
      { id: "minimax-m2.7", label: "MiniMax M2.7", pricing: staticPricing(0.3, 1.2) },
      { id: "longcat-2.5-preview-free", label: "LongCat 2.5 Preview (Free)", contextLength: 1000000, pricing: staticPricing(0, 0) },
    ],
  },
};

export function listProviderIds(): ProviderId[] { return Object.keys(PROVIDERS) as ProviderId[]; }

export function getProvider(id: ProviderId): ProviderConfig {
  const p = PROVIDERS[id];
  if (!p) throw new Error(`مزود غير معروف: ${String(id)}`);
  return p;
}

function isRate(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

// A provider that reported cache activity without publishing its rate leaves the cost
// unknown; substituting zero would understate the bill, so it returns null instead.
export function computeCost(usage: CostUsage, model: Pick<ModelInfo, "pricing">): number | null {
  const pricing = model.pricing;
  if (!pricing) return null;
  const cachedInputTokens = Math.max(0, usage.cachedInputTokens ?? 0);
  const cacheWriteInput = Math.max(0, usage.cacheWriteInputTokens ?? 0);
  if (cachedInputTokens > 0 && !isRate(pricing.cacheReadPerMTok)) return null;
  if (cacheWriteInput > 0 && !isRate(pricing.cacheWritePerMTok)) return null;
  const uncachedInput = Math.max(0, usage.inputTokens - cachedInputTokens - cacheWriteInput);
  return (uncachedInput / 1e6) * pricing.inputPerMTok
    + (cachedInputTokens / 1e6) * (pricing.cacheReadPerMTok ?? 0)
    + (cacheWriteInput / 1e6) * (pricing.cacheWritePerMTok ?? 0)
    + (Math.max(0, usage.outputTokens) / 1e6) * pricing.outputPerMTok;
}

// The one header builder. Chat, model construction, and key tests must send the same
// provider identity and session header, otherwise a green key test proves less than a
// real request does.
export function headersFor(providerId: ProviderId, sessionId?: string): Record<string, string> {
  const provider = getProvider(providerId);
  const headers: Record<string, string> = { ...(provider.defaultHeaders ?? {}) };
  const session = typeof sessionId === "string" ? sessionId.trim() : "";
  if (provider.sessionHeaderName && session) headers[provider.sessionHeaderName] = session;
  return headers;
}


export type CostUsage = Pick<Usage, "inputTokens" | "outputTokens"> & Partial<Pick<Usage, "cachedInputTokens" | "cacheWriteInputTokens">>;

export type FetchLike = typeof fetch;

export function buildLanguageModel(providerId: ProviderId, apiKey: string, modelId: string, fetchImpl: FetchLike, extraHeaders?: Record<string, string>): LanguageModel {
  if (!apiKey.trim()) throw new Error(`مفتاح API للمزود ${getProvider(providerId).label} غير مضبوط — أضفه من الإعدادات`);
  const p = getProvider(providerId);
  const headers = { ...headersFor(providerId), ...(extraHeaders ?? {}) };
  if (p.kind === "google") {
    const g = createGoogleGenerativeAI({ apiKey, baseURL: p.baseURL, headers, fetch: fetchImpl });
    return g(modelId);
  }
  const oc = createOpenAICompatible({ name: providerId, baseURL: p.baseURL, apiKey, headers, fetch: fetchImpl });
  return oc(modelId);
}