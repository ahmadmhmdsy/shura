/**
 * مزوّدو النماذج وعقود التسعير/الوصف.
 * Domain: providers — provider identity, model descriptors and pricing.
 * لا يعتمد على أي وحدة أنواع أخرى (ورقة الشجرة).
 */

export type ProviderId = "openrouter" | "google" | "minimax" | "opencodego";

export interface ModelPricing { inputPerMTok: number; outputPerMTok: number; cacheReadPerMTok?: number; cacheWritePerMTok?: number; }
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
  /**
   * A free, non-generating endpoint used to prove a key is accepted.
   * Key validation must never spend generation quota, so this deliberately points at a
   * listing endpoint rather than a completion endpoint.
   */
  keyCheckUrl?: string;
  /** How the key travels: "bearer" sends an Authorization header, "query" appends ?key=. */
  keyCheckAuth?: "bearer" | "query";
}
