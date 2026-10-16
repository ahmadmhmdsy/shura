/**
 * [T8.6] حَوْض كتابة الخلاصة (أرشفة القرص + الأحداث الجانبية للتكلفة). نُقل حرفيًا من
 * `useSummaryExtraction` لتقليص حجم الخطّاف دون تغيير سلوكي: يستقبل سياق العملية صراحةً
 * ويشترط ملكية العملية للكتابة الحيّة والدائمة على السواء.
 */
import { useSessionsStore } from "@/state/sessionsStore";
import { newId } from "@/lib/id";
import { recordUsage, updateSessionIfOperation } from "@/lib/db/repos";
import { getFileSink, isFilePersistActive } from "@/lib/markdown/sink";
import { appendTurn, sessionFolderName } from "@/lib/markdown/writer";
import { uiText } from "@/i18n";
import type { ChatMessage, ProviderId, SessionMeta, TurnStatus } from "@/types";

export interface SummaryPersistenceDeps {
  session: SessionMeta;
  operationId: string;
  turnId: string;
  targetId: string;
  attemptId: string;
  createdAt: number;
  primary: { providerId: ProviderId; modelId: string };
  operationIsCurrent: () => boolean;
  isLiveOwner: () => boolean;
}

/**
 * Builds the write-side helpers for one summary operation. `runSummarySidecars` records the
 * usage event and archives the turn on disk, then reports a bounded warning joined for the
 * transcript. Both writers are gated on real ownership, so a canceled operation never runs
 * success-only sidecars.
 */
export function createSummaryPersistence(deps: SummaryPersistenceDeps): {
  runSummarySidecars: (
    text: string,
    status: TurnStatus,
    error: string | undefined,
    usage: ChatMessage["usage"],
    durationMs: number | undefined,
  ) => Promise<string | undefined>;
} {
  const { session, operationId, turnId, targetId, attemptId, createdAt, primary, operationIsCurrent, isLiveOwner } = deps;

  const archiveSummary = async (
    text: string,
    status: TurnStatus,
    error: string | undefined,
    usage: ChatMessage["usage"],
  ): Promise<void> => {
    if (!isFilePersistActive()) return;
    let effectiveSession = session;
    if (!effectiveSession.onDiskDir) {
      const folder = sessionFolderName(effectiveSession.title, effectiveSession.id, effectiveSession.createdAt);
      const updated = await updateSessionIfOperation(effectiveSession.id, operationId, { onDiskDir: folder }, operationIsCurrent);
      if (!updated) throw new Error(uiText.t("chat.internal.operationOwnershipChanged"));
      if (isLiveOwner()) {
        useSessionsStore.setState((state) => ({
          sessions: state.sessions.map((item) => item.id === effectiveSession.id ? { ...item, onDiskDir: folder } : item),
        }));
      }
      effectiveSession = { ...effectiveSession, onDiskDir: folder };
    }
    await appendTurn(getFileSink(), "sessions/" + effectiveSession.onDiskDir, effectiveSession, {
      turn: { id: turnId, sharedPrompt: text, customs: {} },
      // A v2 synthesis entry carries the primary target snapshot so recovery can
      // attribute its usage instead of fabricating a provider.
      prompts: [{
        targetId,
        providerId: primary.providerId,
        modelId: primary.modelId,
        text,
        hasShared: true,
        hasCustom: false,
      }],
      results: [{ targetId, text, usage: usage ?? null }],
      status: { [targetId]: status },
      errors: error === undefined ? {} : { [targetId]: error },
      createdAt,
      attemptId,
      operationId,
    });
  };

  const runSummarySidecars = async (
    text: string,
    status: TurnStatus,
    error: string | undefined,
    usage: ChatMessage["usage"],
    durationMs: number | undefined,
  ): Promise<string | undefined> => {
    const sidecars: Promise<{ warning?: string }>[] = [];
    if (durationMs !== undefined) {
      sidecars.push(
        recordUsage({
          id: newId("u"),
          sessionId: session.id,
          turnId,
          ts: Date.now(),
          providerId: primary.providerId,
          modelId: primary.modelId,
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          cachedInputTokens: usage?.cachedInputTokens ?? 0,
          cacheWriteInputTokens: usage?.cacheWriteInputTokens ?? 0,
          costUSD: usage?.costUSD ?? null,
          toolCalls: 0,
          durationMs,
          status: status === "error" ? "error" : "ok",
          attemptId,
          operationId,
        }).then(() => ({})).catch(() => ({ warning: uiText.t("chat.usageEventSaveFailed") })),
      );
    }
    if (isFilePersistActive()) {
      sidecars.push(archiveSummary(text, status, error, usage).then(() => ({})).catch(() => ({ warning: uiText.t("chat.summary.archiveFailed") })));
    }
    const settled = await Promise.allSettled(sidecars);
    const warnings = settled
      .filter((result): result is PromiseFulfilledResult<{ warning?: string }> => result.status === "fulfilled")
      .map((result) => result.value.warning)
      .filter((warning): warning is string => Boolean(warning));
    return warnings.length ? warnings.join(uiText.t("common.warningSeparator")) : undefined;
  };

  return { runSummarySidecars };
}
