/**
 * عقود الدردشة: الجلسات، الرسائل، التمرّرات، المحاولات والاستهلاك.
 * Domain: chat — sessions, messages, turns, attempts and usage.
 * يعتمد على ./providers فقط.
 */

import type { ModelInfo, ProviderId } from "./providers";

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
