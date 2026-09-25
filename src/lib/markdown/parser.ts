import type { FileSink } from "./sink";
import { quarantineDirOf, readDiskTombstones, RESERVED_ARCHIVE_DIRS } from "./archivePaths";
import { redactExternalError } from "@/lib/security/redact";
import { LIMITS } from "@/lib/limits";
import { buildRecoveredUsageEvent } from "./recoveryUsage";
import { ArchiveValidationError, readArchiveManifest, renderSessionMarkdown, type ArchiveManifest, type ArchiveTurn } from "./writer";
import type { ChatMessage, ContextMode, ProviderId, SessionMeta, TurnAttempt, TurnRecord, TurnStatus, UsageEvent } from "@/types";

export interface RestoredSession {
  meta: SessionMeta;
  messages: ChatMessage[];
  usageEvents: UsageEvent[];
  turns: TurnRecord[];
  /** Usage kept on the message when the archive has no provider snapshot for it. */
  unattributedUsage?: number;
}

export interface RecoveryReport {
  imported: RestoredSession[];
  quarantined: { dir: string; reason: string }[];
  skippedTombstoned: string[];
  errors: string[];
}

export interface RecoveryOptions {
  /** Lets startup supply Dexie tombstones without coupling this module to the database. */
  isTombstoned?: (id: string) => Promise<boolean>;
  now?: () => number;
}

const RECOVERY_ERROR_MAX_CHARS = 240;

/** Same aggregation rule as the controller: any error wins, all-stopped is stopped. */
function aggregateStatus(statuses: TurnStatus[]): TurnStatus {
  if (!statuses.length) return "error";
  if (statuses.includes("error")) return "error";
  if (statuses.every((status) => status === "stopped")) return "stopped";
  return "done";
}

function isSummaryTurn(turn: ArchiveTurn): boolean {
  return turn.kind === "summary" || turn.turnId.startsWith("syn-");
}

function messageId(turn: ArchiveTurn, suffix: string): string {
  return turn.turnId + ":" + turn.attemptId + ":" + suffix;
}

function buildMessages(turn: ArchiveTurn, meta: SessionMeta, superseded: boolean): { messages: ChatMessage[]; usageEvents: UsageEvent[]; unattributed: number } {
  const messages: ChatMessage[] = [];
  const usageEvents: UsageEvent[] = [];
  const base = {
    sessionId: meta.id,
    turnId: turn.turnId,
    attemptId: turn.attemptId,
    operationId: turn.operationId,
    attempt: turn.attempt,
    ...(superseded ? { superseded: true } : {}),
  };
  if (isSummaryTurn(turn)) {
    let unattributed = 0;
    for (const result of turn.results) {
      const prompt = turn.prompts.find((p) => p.targetId === result.targetId);
      const providerId = prompt ? (prompt.providerId as ProviderId) : undefined;
      messages.push({
        ...base,
        id: messageId(turn, result.targetId),
        createdAt: turn.createdAt,
        role: "assistant",
        kind: "synthesis",
        text: result.text,
        providerId,
        modelId: prompt ? prompt.modelId : undefined,
        modelInfo: prompt ? prompt.modelInfo : undefined,
        targetId: result.targetId,
        status: result.status,
        ...(result.error ? { error: result.error } : {}),
        ...(result.usage ? { usage: result.usage } : {}),
      });
      if (!result.usage) continue;
      const event = buildRecoveredUsageEvent(turn, meta, result, prompt);
      if (event) usageEvents.push(event);
      else unattributed += 1;
    }
    return { messages, usageEvents, unattributed };
  }
  if (turn.sharedPrompt) {
    messages.push({
      ...base,
      id: messageId(turn, "shared"),
      createdAt: turn.createdAt,
      role: "user",
      kind: "prompt",
      text: turn.sharedPrompt,
      promptKind: "shared",
      status: "done",
    });
  }
  for (const prompt of turn.prompts.filter((p) => p.hasCustom && p.customPrompt)) {
    messages.push({
      ...base,
      id: messageId(turn, prompt.targetId + ":custom"),
      createdAt: turn.createdAt + 1,
      role: "user",
      kind: "prompt",
      text: prompt.customPrompt as string,
      targetId: prompt.targetId,
      promptKind: "custom",
      status: "done",
    });
  }
  let unattributed = 0;
  for (const result of turn.results) {
    const prompt = turn.prompts.find((p) => p.targetId === result.targetId);
    const providerId = prompt?.providerId as ProviderId | undefined;
    messages.push({
      ...base,
      id: messageId(turn, result.targetId),
      createdAt: turn.createdAt + 2,
      role: "assistant",
      kind: "result",
      text: result.text,
      ...(providerId ? { providerId } : {}),
      ...(prompt ? { modelId: prompt.modelId, modelInfo: prompt.modelInfo } : {}),
      targetId: result.targetId,
      status: result.status,
      ...(result.error ? { error: result.error } : {}),
      ...(result.usage ? { usage: result.usage } : {}),
    });
    if (!result.usage) continue;
    if (!providerId || !prompt) {
      unattributed += 1;
      continue;
    }
    usageEvents.push({
      id: messageId(turn, result.targetId),
      sessionId: meta.id,
      turnId: turn.turnId,
      ts: turn.createdAt,
      providerId,
      modelId: prompt.modelId,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cachedInputTokens: result.usage.cachedInputTokens,
      cacheWriteInputTokens: result.usage.cacheWriteInputTokens ?? 0,
      costUSD: result.usage.costUSD,
      toolCalls: 0,
      durationMs: 0,
      status: result.status === "error" ? "error" : "ok",
      attemptId: turn.attemptId,
      operationId: turn.operationId,
    });
  }
  return { messages, usageEvents, unattributed };
}

function buildTurns(manifest: ArchiveManifest): TurnRecord[] {
  const records = new Map<string, TurnRecord>();
  for (const turn of manifest.turns) {
    const attempt: TurnAttempt = {
      id: turn.attemptId,
      turnId: turn.turnId,
      attempt: turn.attempt,
      kind: turn.kind,
      createdAt: turn.createdAt,
      status: aggregateStatus(turn.results.map((result) => result.status)),
      ...(turn.operationId ? { operationId: turn.operationId } : {}),
      ...(turn.superseded ? { superseded: true } : {}),
      targets: turn.prompts.map((prompt) => ({ ...prompt })),
    };
    const existing = records.get(turn.turnId);
    if (existing) {
      existing.attempts.push(attempt);
      continue;
    }
    records.set(turn.turnId, {
      id: turn.turnId,
      sessionId: manifest.meta.id,
      createdAt: turn.createdAt,
      status: attempt.status,
      contextMode: (manifest.meta.contextMode ?? "stateful") as ContextMode,
      sharedPrompt: turn.sharedPrompt,
      attempts: [attempt],
    });
  }
  for (const record of records.values()) {
    record.attempts.sort((a, b) => a.attempt - b.attempt);
    // Only the newest attempt is current; older data is kept but never allowed to win.
    for (const attempt of record.attempts.slice(0, -1)) attempt.superseded = true;
    const latest = record.attempts[record.attempts.length - 1];
    if (latest) record.status = latest.status;
  }
  return [...records.values()];
}
/** Repairs presentation only: the manifest stays the single source of truth. */
async function repairSessionMarkdown(sink: FileSink, dir: string, manifest: ArchiveManifest): Promise<void> {
  if (await sink.exists(dir + "/session.md")) return;
  await sink.writeFile(dir + "/session.md", renderSessionMarkdown(manifest));
}

export async function importSessionFromDisk(sink: FileSink, dir: string): Promise<RestoredSession> {
  const manifest = await readArchiveManifest(sink, dir);
  if (!manifest) throw new ArchiveValidationError("لا يوجد مخطط صالح لهذا المجلد");
  const turns = buildTurns(manifest);
  const latestAttempt = new Map<string, string>();
  for (const record of turns) latestAttempt.set(record.id, record.attempts[record.attempts.length - 1]?.id ?? "");
  const messages: ChatMessage[] = [];
  const usageEvents: UsageEvent[] = [];
  let unattributed = 0;
  for (const turn of manifest.turns) {
    const superseded = latestAttempt.get(turn.turnId) !== turn.attemptId;
    const built = buildMessages(turn, manifest.meta, superseded);
    messages.push(...built.messages);
    usageEvents.push(...built.usageEvents);
    unattributed += built.unattributed;
  }
  await repairSessionMarkdown(sink, dir, manifest);
  return {
    meta: manifest.meta,
    messages,
    usageEvents,
    turns,
    // Never invent provider attribution: the usage stays on the message and the
    // limitation is reported instead of fabricating a usage_events row.
    ...(unattributed > 0 ? { unattributedUsage: unattributed } : {}),
  };
}

export interface QuarantineEntry { dir: string; reason: string; }

type QuarantineOutcome = { ok: true; dir: string } | { ok: false; reason: string };

async function quarantineFolder(sink: FileSink, rootDir: string, name: string, now: () => number): Promise<QuarantineOutcome> {
  const dir = rootDir.replace(/[\\/]+$/, "") + "/" + name;
  const target = quarantineDirOf(rootDir) + "/" + name + "-" + now();
  try {
    await sink.ensureDir(quarantineDirOf(rootDir));
    await sink.rename(dir, target);
    return { ok: true, dir: target };
  } catch (error) {
    // The source stays untouched so a failed quarantine never destroys user data.
    return {
      ok: false,
      reason: redactExternalError(error, { maxCodePoints: RECOVERY_ERROR_MAX_CHARS }) + " (تعذّر نقل المجلد إلى الحجر)",
    };
  }
}

export async function recoverFromDisk(sink: FileSink, rootDir: string, options: RecoveryOptions = {}): Promise<RecoveryReport> {
  const now = options.now ?? Date.now;
  const report: RecoveryReport = { imported: [], quarantined: [], skippedTombstoned: [], errors: [] };
  const root = rootDir.replace(/[\\/]+$/, "");
  let diskTombstones: Set<string>;
  try {
    diskTombstones = await readDiskTombstones(sink, root);
  } catch (error) {
    // Fail closed: an unreadable witness set must never be treated as "no deletion".
    report.errors.push(redactExternalError(error, { maxCodePoints: RECOVERY_ERROR_MAX_CHARS }));
    return report;
  }
  let names: string[];
  try {
    names = await sink.readDir(root);
  } catch (error) {
    report.errors.push(redactExternalError(error, { maxCodePoints: RECOVERY_ERROR_MAX_CHARS }));
    return report;
  }
  for (const name of names) {
    if (RESERVED_ARCHIVE_DIRS.includes(name)) continue;
    const dir = `${root}/${name}`;
    if (!(await sink.exists(dir + "/meta.json"))) continue;
    let restored: RestoredSession;
    let manifest: ArchiveManifest;
    try {
      // A folder past the hard archive ceiling is quarantined rather than parsed, so a
      // runaway or hostile file cannot exhaust memory during recovery.
      const manifestBytes = await sink.readFile(dir + "/meta.json");
      if (manifestBytes.length > LIMITS.archiveMaxChars) {
        throw new Error("حجم الأرشيف يتجاوز الحد المسموح");
      }
      manifest = (await readArchiveManifest(sink, dir))!;
      restored = await importSessionFromDisk(sink, dir);
    } catch (error) {
      const reason = redactExternalError(error, { maxCodePoints: RECOVERY_ERROR_MAX_CHARS });
      const outcome = await quarantineFolder(sink, root, name, now);
      if (outcome.ok) report.quarantined.push({ dir: outcome.dir, reason });
      else report.errors.push(outcome.reason);
      continue;
    }
    const sessionId = manifest.meta.id;
    let dbTombstoned: boolean;
    try {
      dbTombstoned = (await options.isTombstoned?.(sessionId)) ?? false;
    } catch (error) {
      report.errors.push(redactExternalError(error, { maxCodePoints: RECOVERY_ERROR_MAX_CHARS }));
      continue;
    }
    if (diskTombstones.has(sessionId) || dbTombstoned) {
      report.skippedTombstoned.push(sessionId);
      continue;
    }
    if (typeof restored.unattributedUsage === "number") {
      report.errors.push("استهلاك بلا نسبة مزوّد محفوظ على الرسالة دون اختراع مزوّد: " + restored.unattributedUsage);
    }
    report.imported.push(restored);
  }
  return report;
}