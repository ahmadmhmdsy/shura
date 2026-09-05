export type ProviderId = "openrouter" | "google" | "minimax" | "opencodego";

export interface ModelPricing { inputPerMTok: number; outputPerMTok: number; }
export interface ModelInfo { id: string; label: string; contextLength?: number; pricing?: ModelPricing | null; }

export type ProviderKind = "openai-compatible" | "google";
export interface ProviderConfig {
  id: ProviderId;
  label: string;
  browserDirect: boolean;
  kind: ProviderKind;
  baseURL: string;
  defaultHeaders?: Record<string, string>;
  sessionHeaderName?: string;
  staticModels: ModelInfo[];
  modelsSource: "live" | "static";
  liveModelsUrl?: string;
}

export type MessageStatus = "pending" | "streaming" | "done" | "error" | "stopped";
export type PromptKind = "shared" | "custom";

export interface Usage { inputTokens: number; outputTokens: number; cachedInputTokens: number; costUSD: number | null; }

export interface SessionMeta {
  id: string; title: string; createdAt: number; updatedAt: number;
  modelIds: string[]; primaryTarget: { providerId: ProviderId; modelId: string } | null;
  layoutMode: "vertical" | "horizontal"; onDisk: boolean;
}

export interface ChatMessage {
  id: string; sessionId: string; turnId: string; createdAt: number;
  role: "user" | "assistant";
  kind: "prompt" | "result" | "synthesis";
  text: string;
  providerId?: ProviderId; modelId?: string; targetId?: string;
  promptKind?: PromptKind;
  status: MessageStatus; error?: string; usage?: Usage;
}

export interface UsageEvent {
  id: string; sessionId: string; turnId: string; ts: number;
  providerId: ProviderId; modelId: string;
  inputTokens: number; outputTokens: number; cachedInputTokens: number;
  costUSD: number | null; toolCalls: number; durationMs: number; status: "ok" | "error";
}

export interface Turn { id: string; sharedPrompt: string | null; customs: Record<string, string>; }

export interface BuiltPrompt {
  targetId: string; providerId: ProviderId; modelId: string;
  text: string; hasShared: boolean; hasCustom: boolean;
}
