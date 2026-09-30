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

export type MessageStatus = "pending" | "streaming" | "done" | "error" | "stopped";
export type PromptKind = "shared" | "custom";

export interface Usage {
  inputTokens: number; outputTokens: number; cachedInputTokens: number;
  /** أُضيف في المخطط v2؛ الصفوف القديمة تعتبر 0 */
  cacheWriteInputTokens?: number;
  costUSD: number | null;
}

export interface SessionMeta {
  id: string; title: string; createdAt: number; updatedAt: number;
  modelIds: string[]; primaryTarget: { providerId: ProviderId; modelId: string } | null;
  layoutMode: "vertical" | "horizontal"; onDisk: boolean;
  /** يُملأ عند أول إرسال في وضع سطح المكتب باسم مجلد الجلسة (ملاحظة الخطة، المهمة 11) */
  onDiskDir?: string;
  /** حقول المخطط v2: غائبة في الصفوف القديمة، والمهاجرة تملؤها */
  contextMode?: ContextMode;
  targets?: TargetConfig[];
}

export interface ChatMessage {
  id: string; sessionId: string; turnId: string; createdAt: number;
  role: "user" | "assistant";
  kind: "prompt" | "result" | "synthesis";
  text: string;
  providerId?: ProviderId; modelId?: string; targetId?: string; modelInfo?: ModelInfo;
  promptKind?: PromptKind;
  status: MessageStatus; error?: string; usage?: Usage;
  /** [المهمة 5] تحذير ثراث جانبي غير نهائي: فشل الاستهلاك/الأرشفة لا يمس النص ولا الحالة */
  sidecarWarning?: string;
  /** حقول المخطط v2: اختيارية للصفوف القديمة فقط؛ كل سجل جديد يملؤها */
  attemptId?: string;
  operationId?: string;
  attempt?: number;
  superseded?: boolean;
}

export interface UsageEvent {
  id: string; sessionId: string; turnId: string; ts: number;
  providerId: ProviderId; modelId: string;
  inputTokens: number; outputTokens: number; cachedInputTokens: number;
  cacheWriteInputTokens?: number;
  costUSD: number | null; toolCalls: number; durationMs: number; status: "ok" | "error";
  /** اختياري للصفوف القديمة فقط؛ كل حدث جديد يملؤه */
  attemptId?: string;
  operationId?: string;
}

export interface Turn { id: string; sharedPrompt: string | null; customs: Record<string, string>; }

/** عقود نطاق دائمة تُستخدم في كل مهام التعزيز اللاحقة */
export type ContextMode = "stateful" | "stateless";
export type TurnStatus = "pending" | "streaming" | "done" | "stopped" | "error";

export interface TargetConfig {
  targetId: string;
  providerId: ProviderId;
  modelId: string;
  modelInfo: ModelInfo;
}

export interface TargetSnapshot extends TargetConfig {
  sharedPrompt: string | null;
  customPrompt: string | null;
  promptText: string;
  hasShared: boolean;
  hasCustom: boolean;
}

export interface TurnAttempt {
  id: string;
  turnId: string;
  attempt: number;
  kind: "send" | "retry" | "summary";
  createdAt: number;
  status: TurnStatus;
  operationId?: string;
  superseded?: boolean;
  /**
   * Explicit durable association to the pre-identity message this attempt was
   * backfilled from. A legacy row has no operationId/attemptId of its own, so the
   * link must be recorded by the backfill itself instead of being guessed later.
   */
  sourceMessageId?: string;
  targets: TargetSnapshot[];
}

export interface OperationLease {
  sessionId: string;
  operationId: string;
  turnId: string;
  generation: number;
  status: "active" | "finished" | "cancelled";
  updatedAt: number;
}

export interface TurnRecord {
  id: string;
  sessionId: string;
  createdAt: number;
  status: TurnStatus;
  contextMode: ContextMode;
  sharedPrompt: string | null;
  attempts: TurnAttempt[];
}

export interface SessionTombstone { id: string; deletedAt: number; }

export interface BuiltPrompt {
  targetId: string; providerId: ProviderId; modelId: string;
  text: string; hasShared: boolean; hasCustom: boolean;
}

// === RAG Types ===

export type RagSource = "upload" | "external" | "session";
export type RagPersistence = "persistent" | "temp";
export type RagStatus = "pending" | "indexing" | "indexed" | "error";
export type RagSearchMode = "hybrid" | "semantic" | "keyword";
export type RagSearchScope = "all" | "uploads" | "sessions" | "external";
export type RagTempCleanup = "after_turn" | "after_session" | "manual";

export interface RagDocument {
  id: string;
  source: RagSource;
  persistence: RagPersistence;
  fileName: string;
  fileType: string;
  fileSize: number;
  status: RagStatus;
  error?: string;
  uploadedAt: number;
  sessionId?: string;
  folderId?: string;
  chunkCount: number;
  embeddingModelId: string;
}

export interface RagChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  text: string;
  embedding: number[];
  metadata: {
    pageNumber?: number;
    source: string;
    timestamp: number;
  };
}

export interface RagFolder {
  id: string;
  path: string;
  label: string;
  autoReindex: boolean;
  lastIndexedAt: number | null;
  status: "active" | "error";
  error?: string;
}

export interface RagModel {
  id: string;
  modelId: string;
  label: string;
  dimensions: number;
  downloadedAt: number;
  sizeBytes: number;
}

export interface RagSettings {
  embeddingModelId: string;
  chunkSize: number;
  chunkOverlap: number;
  defaultPersistence: RagPersistence | "ask";
  tempCleanup: RagTempCleanup;
  defaultSearchMode: RagSearchMode;
  searchResultCount: number;
  autoReindexFolders: boolean;
  agentMode: "always" | "toggle";
}

export const DEFAULT_RAG_SETTINGS: RagSettings = {
  embeddingModelId: "multilingual-e5-small",
  chunkSize: 500,
  chunkOverlap: 100,
  defaultPersistence: "ask",
  tempCleanup: "after_turn",
  defaultSearchMode: "hybrid",
  searchResultCount: 5,
  autoReindexFolders: true,
  agentMode: "always",
};