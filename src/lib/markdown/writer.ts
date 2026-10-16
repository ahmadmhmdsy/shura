import { runExclusiveInArchive } from "./archiveQueue";
import { uiText } from "@/i18n";
import { UNKNOWN_COST, formatCost } from "@/lib/usage/cost";
import { archiveRootOf, readDiskTombstones } from "./archivePaths";
import type { FileSink } from "./sink";
import { redactExternalError } from "@/lib/security/redact";
import type { ModelInfo, ProviderId, SessionMeta, TargetSnapshot, Turn, TurnStatus, Usage } from "@/types";

export const ARCHIVE_SCHEMA_VERSION = 2 as const;

export interface ArchiveResult {
  targetId: string;
  text: string;
  status: TurnStatus;
  error?: string;
  usage: Usage | null;
}

/** One manifest entry is exactly one persisted attempt. */
export interface ArchiveTurn {
  id: string;
  turnId: string;
  attemptId: string;
  attempt: number;
  kind: "send" | "retry" | "summary";
  operationId?: string;
  dirName: string;
  sharedPrompt: string | null;
  prompts: TargetSnapshot[];
  results: ArchiveResult[];
  status: Record<string, TurnStatus>;
  errors: Record<string, string>;
  createdAt: number;
  superseded?: boolean;
}

export interface ArchiveManifest {
  schemaVersion: typeof ARCHIVE_SCHEMA_VERSION;
  meta: SessionMeta;
  updatedAt: number;
  turns: ArchiveTurn[];
}

export interface TurnFileData {
  turn: Turn;
  prompts: { targetId: string; providerId: ProviderId; modelId: string; text: string; hasShared: boolean; hasCustom: boolean }[];
  results: { targetId: string; text: string; usage: Usage | null }[];
  status: Record<string, string>;
  errors: Record<string, string>;
  createdAt: number;
  /** Durable operation identity for replay/reconciliation metadata. */
  attemptId?: string;
  operationId?: string;
  attemptNumber?: number;
  kind?: "send" | "retry" | "summary";
}

const ILLEGAL = /[<>:"/\\|?*]/g;
const ARCHIVE_ERROR_MAX_CHARS = 512;
const TURN_STATUSES: readonly TurnStatus[] = ["pending", "streaming", "done", "stopped", "error", "truncated"];
const ATTEMPT_KINDS = ["send", "retry", "summary"] as const;
const DIR_NAME_PATTERN = /^turns\/t\d{2,}$/;

export class ArchiveValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveValidationError";
  }
}

/** [المهمة 5] حد واحد يشمل المسافات والعلامة، مع تطبيق التنقية على الأسرار والمسارات. */
export function boundArchiveError(error: string | undefined): string {
  const normalized = (error ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return redactExternalError(normalized, { maxCodePoints: ARCHIVE_ERROR_MAX_CHARS });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reqId(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ArchiveValidationError("معرّف ناقص: " + field);
  if (value.length > 256) throw new ArchiveValidationError("معرّف طويل: " + field);
  return value;
}

function reqFinite(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ArchiveValidationError("وقت غير صالح: " + field);
  return value;
}

function reqText(value: unknown, field: string): string {
  if (typeof value !== "string") throw new ArchiveValidationError("نص غير صالح: " + field);
  return value;
}

function reqStatus(value: unknown): TurnStatus {
  if (typeof value !== "string" || !TURN_STATUSES.includes(value as TurnStatus)) {
    throw new ArchiveValidationError("حالة غير صالحة");
  }
  return value as TurnStatus;
}

function normalizeUsage(value: unknown): Usage | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw new ArchiveValidationError("استهلاك غير صالح");
  const num = (v: unknown): number => {
    const n = v ?? 0;
    if (typeof n !== "number" || !Number.isFinite(n)) throw new ArchiveValidationError("أرقام استهلاك غير صالحة");
    return n;
  };
  const cost = value.costUSD;
  if (cost !== null && cost !== undefined && (typeof cost !== "number" || !Number.isFinite(cost))) {
    throw new ArchiveValidationError("تكلفة غير صالحة");
  }
  return {
    inputTokens: num(value.inputTokens),
    outputTokens: num(value.outputTokens),
    cachedInputTokens: num(value.cachedInputTokens),
    cacheWriteInputTokens: num(value.cacheWriteInputTokens),
    costUSD: (cost ?? null) as number | null,
  };
}

/**
 * Optional fields are omitted rather than defaulted so a manifest round-trips
 * byte-identically; otherwise idempotency comparison would reject its own writes.
 */
function normalizeModelInfo(value: unknown, modelId: string): ModelInfo {
  if (isRecord(value) && typeof value.id === "string" && value.id) {
    return {
      id: value.id,
      label: typeof value.label === "string" ? value.label : value.id,
      ...(typeof value.contextLength === "number" ? { contextLength: value.contextLength } : {}),
      ...(isRecord(value.pricing)
        ? { pricing: { inputPerMTok: Number(value.pricing.inputPerMTok) || 0, outputPerMTok: Number(value.pricing.outputPerMTok) || 0 } }
        : {}),
    };
  }
  return { id: modelId, label: modelId };
}

function normalizeStatusMap(value: unknown): Record<string, TurnStatus> {
  if (!isRecord(value)) throw new ArchiveValidationError("خريطة الحالات غير صالحة");
  const out: Record<string, TurnStatus> = {};
  for (const [key, status] of Object.entries(value)) out[key] = reqStatus(status);
  return out;
}

function normalizeErrorMap(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new ArchiveValidationError("خريطة الأخطاء غير صالحة");
  const out: Record<string, string> = {};
  for (const [key, text] of Object.entries(value)) out[key] = boundArchiveError(typeof text === "string" ? text : "");
  return out;
}

export function sanitizeTitle(title: string): string {
  // C0 control chars (U+0000-U+001F) are filtered out directly: an explicit control range
  // inside a regex literal is rejected by eslint no-control-regex.
  const clean = [...title].filter((c) => c.codePointAt(0)! > 0x1f).join("");
  return clean.replace(ILLEGAL, "-").replace(/\s+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

export function sessionFolderName(title: string, id: string, createdAt: number): string {
  const d = new Date(createdAt || Date.now());
  const ymd = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
  const base = sanitizeTitle(title) || "بدون-عنوان";
  return `${ymd}_${base}_${id.slice(0, 8)}`;
}

export function usageRow(u: Usage | null): string {
  if (!u) return "| الاستهلاك | غير متوفر |\n";
  const cost = formatCost(u.costUSD, UNKNOWN_COST);
  return `| المدخلات | ${u.inputTokens} |\n| المخرجات | ${u.outputTokens} |\n| الكاش | ${u.cachedInputTokens} |\n| التكلفة | ${cost} |\n`;
}

function pad2(n: number): string { return String(n).padStart(2, "0"); }

export function turnDirName(turnIndex: number): string {
  return `t${pad2(turnIndex + 1)}`;
}

export function resultFileName(index: number, providerId: string, modelId: string): string {
  return `${pad2(index + 1)}_${providerId}__${modelId.replace(/[^\w.-]/g, "_")}.md`;
}
function normalizeSessionMeta(value: unknown, onDiskDir?: string): SessionMeta {
  if (!isRecord(value)) throw new ArchiveValidationError("بيانات الجلسة غير صالحة");
  const id = reqId(value.id, "session.id");
  const createdAt = reqFinite(value.createdAt, "session.createdAt");
  const updatedAt = reqFinite(value.updatedAt, "session.updatedAt");
  return {
    id,
    title: typeof value.title === "string" ? value.title : "",
    createdAt,
    updatedAt,
    modelIds: Array.isArray(value.modelIds) ? value.modelIds.filter((m): m is string => typeof m === "string") : [],
    primaryTarget: isRecord(value.primaryTarget) && typeof value.primaryTarget.providerId === "string"
      ? { providerId: value.primaryTarget.providerId as ProviderId, modelId: String(value.primaryTarget.modelId) }
      : null,
    layoutMode: value.layoutMode === "horizontal" ? "horizontal" : "vertical",
    onDisk: true,
    onDiskDir,
    contextMode: value.contextMode === "stateless" ? "stateless" : "stateful",
    targets: Array.isArray(value.targets) ? (value.targets as TargetConfigLike[]) : [],
  };
}

interface TargetConfigLike {
  targetId: string;
  providerId: ProviderId;
  modelId: string;
  modelInfo: ModelInfo;
}

function normalizeSnapshot(value: unknown): TargetSnapshot {
  if (!isRecord(value)) throw new ArchiveValidationError("لقطة هدف غير صالحة");
  const targetId = reqId(value.targetId, "targetId");
  const providerId = value.providerId as ProviderId;
  const modelId = reqId(value.modelId, "modelId");
  const shared = value.sharedPrompt;
  const custom = value.customPrompt;
  return {
    targetId,
    providerId,
    modelId,
    modelInfo: normalizeModelInfo(value.modelInfo, modelId),
    sharedPrompt: typeof shared === "string" ? shared : null,
    customPrompt: typeof custom === "string" ? custom : null,
    promptText: reqText(value.promptText ?? value.text ?? "", "promptText"),
    hasShared: value.hasShared === true,
    hasCustom: value.hasCustom === true,
  };
}

function normalizeArchiveResults(value: unknown, status: Record<string, TurnStatus>, errors: Record<string, string>): ArchiveResult[] {
  if (!Array.isArray(value)) throw new ArchiveValidationError("قائمة النتائج غير صالحة");
  return value.map((entry) => {
    if (!isRecord(entry)) throw new ArchiveValidationError("نتيجة غير صالحة");
    const targetId = reqId(entry.targetId, "result.targetId");
    const resultStatus = entry.status === undefined ? (status[targetId] ?? "done") : reqStatus(entry.status);
    const error = errors[targetId];
    return {
      targetId,
      text: reqText(entry.text, "result.text"),
      status: resultStatus,
      ...(error ? { error } : {}),
      usage: normalizeUsage(entry.usage),
    };
  });
}

function normalizeArchiveTurn(value: unknown, fallbackDir: string): ArchiveTurn {
  if (!isRecord(value)) throw new ArchiveValidationError("مدخل تمريرة غير صالح");
  const turnId = reqId(value.turnId, "turnId");
  const attemptId = reqId(value.attemptId, "attemptId");
  const attempt = reqFinite(value.attempt, "attempt");
  if (!Number.isInteger(attempt) || attempt < 1) throw new ArchiveValidationError("رقم محاولة غير صالح");
  const kind = ATTEMPT_KINDS.includes(value.kind as (typeof ATTEMPT_KINDS)[number]) ? (value.kind as ArchiveTurn["kind"]) : "send";
  const dirName = typeof value.dirName === "string" && DIR_NAME_PATTERN.test(value.dirName) ? value.dirName : fallbackDir;
  const status = normalizeStatusMap(value.status);
  const errors = normalizeErrorMap(value.errors);
  const prompts = Array.isArray(value.prompts) ? value.prompts.map(normalizeSnapshot) : [];
  const shared = value.sharedPrompt;
  return {
    // v2 is a closed schema: a missing id is corruption, not a value to derive.
    id: reqId(value.id, "id"),
    turnId,
    attemptId,
    attempt,
    kind,
    ...(typeof value.operationId === "string" ? { operationId: value.operationId } : {}),
    dirName,
    sharedPrompt: typeof shared === "string" ? shared : null,
    prompts,
    results: normalizeArchiveResults(value.results, status, errors),
    status,
    errors,
    createdAt: reqFinite(value.createdAt, "createdAt"),
    ...(value.superseded === true ? { superseded: true } : {}),
  };
}

function validateV2Manifest(value: unknown, onDiskDir?: string): ArchiveManifest {
  if (!isRecord(value)) throw new ArchiveValidationError("بنية المخطط غير صالحة");
  if (!Array.isArray(value.turns)) throw new ArchiveValidationError("قائمة التمريرات غير صالحة");
  return {
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    meta: normalizeSessionMeta(value.meta, onDiskDir),
    updatedAt: reqFinite(value.updatedAt, "updatedAt"),
    turns: value.turns.map((entry, index) => normalizeArchiveTurn(entry, `turns/${turnDirName(index)}`)),
  };
}

/** Legacy v1 prompts carried combined text and no modelInfo; nothing is invented. */
function normalizeV1Prompt(value: unknown, sharedPrompt: string | null): TargetSnapshot {
  if (!isRecord(value)) throw new ArchiveValidationError("مدخل prompt قديم غير صالح");
  const targetId = reqId(value.targetId, "prompt.targetId");
  const modelId = reqId(value.modelId, "prompt.modelId");
  const text = reqText(value.text ?? "", "prompt.text");
  const hasCustom = value.hasCustom === true;
  return {
    targetId,
    providerId: value.providerId as ProviderId,
    modelId,
    modelInfo: normalizeModelInfo(value.modelInfo, modelId),
    sharedPrompt,
    customPrompt: hasCustom ? text : null,
    promptText: text,
    hasShared: value.hasShared === true,
    hasCustom,
  };
}

/** Unversioned manifests are schema v1: normalize them without deleting anything. */
function normalizeV1Manifest(value: unknown, onDiskDir: string): ArchiveManifest {
  if (!isRecord(value)) throw new ArchiveValidationError("بنية المخطط القديم غير صالحة");
  if (!Array.isArray(value.turns)) throw new ArchiveValidationError("قائمة التمريرات القديمة غير صالحة");
  const meta = normalizeSessionMeta(value.meta, onDiskDir);
  const counters = new Map<string, number>();
  const turns = value.turns.map((entry, index) => {
    if (!isRecord(entry)) throw new ArchiveValidationError("مدخل قديم غير صالح");
    const legacyTurn = isRecord(entry.turn) ? entry.turn : {};
    const turnId = reqId(legacyTurn.id, "turn.id");
    const dirName = typeof entry.dirName === "string" && DIR_NAME_PATTERN.test(entry.dirName) ? entry.dirName : `turns/${turnDirName(index)}`;
    const sharedPrompt = typeof legacyTurn.sharedPrompt === "string" ? legacyTurn.sharedPrompt : null;
    const next = (counters.get(turnId) ?? 0) + 1;
    counters.set(turnId, next);
    const status = normalizeStatusMap(entry.status);
    const errors = normalizeErrorMap(entry.errors);
    const prompts = Array.isArray(entry.prompts) ? entry.prompts.map((p) => normalizeV1Prompt(p, sharedPrompt)) : [];
    return {
      id: turnId,
      turnId,
      attemptId: typeof entry.attemptId === "string" && entry.attemptId ? entry.attemptId : `legacy:${turnId}:${dirName}`,
      attempt: next,
      kind: (turnId.startsWith("syn-") ? "summary" : "send") as ArchiveTurn["kind"],
      ...(typeof entry.operationId === "string" ? { operationId: entry.operationId } : {}),
      dirName,
      sharedPrompt,
      prompts,
      results: normalizeArchiveResults(entry.results, status, errors),
      status,
      errors,
      createdAt: reqFinite(entry.createdAt, "createdAt"),
    };
  });
  return { schemaVersion: ARCHIVE_SCHEMA_VERSION, meta, updatedAt: meta.updatedAt, turns };
}

export async function readArchiveManifest(sink: FileSink, dir: string): Promise<ArchiveManifest | null> {
  if (!(await sink.exists(dir + "/meta.json"))) return null;
  const raw = await sink.readFile(dir + "/meta.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ArchiveValidationError("meta.json تالف");
  }
  const onDiskDir = dir.replace(/[\\/]+$/, "").split("/").pop();
  if (isRecord(parsed) && parsed.schemaVersion === ARCHIVE_SCHEMA_VERSION) return validateV2Manifest(parsed, onDiskDir);
  if (isRecord(parsed) && parsed.schemaVersion === undefined) return normalizeV1Manifest(parsed, onDiskDir ?? "");
  throw new ArchiveValidationError("نسخة مخطط الأرشيف غير مدعومة");
}
function resultHeading(target: ArchiveTurn, result: ArchiveResult): string {
  // A summary keeps its synthesis label even when it carries a target snapshot for
  // usage attribution: the label describes the result kind, not the provider.
  if (target.kind === "summary" || target.turnId.startsWith("syn-")) return "خلاصة النموذج الأساسي (synthesis)";
  const prompt = target.prompts.find((p) => p.targetId === result.targetId);
  if (!prompt) return "خلاصة النموذج الأساسي (synthesis)";
  return `${prompt.providerId} — ${prompt.modelId}`;
}

function resultBody(target: ArchiveTurn, result: ArchiveResult): string {
  const error = target.errors[result.targetId] ?? "خطأ";
  if (result.status === "error" && result.text.trim()) return result.text + "\n\n⛔ " + error;
  if (result.status === "error") return "⛔ " + error;
  return result.text;
}

/**
 * The archive's timestamp format. The locale is deliberately not part of it: it comes from
 * the one app formatter (`uiText.formatDate`), so the archive follows the active language
 * instead of the fixed `"ar"` it used to carry (T3.3/D3). The options are the explicit form
 * of what `toLocaleString` used to produce by default, so an Arabic archive is byte-identical.
 */
const ARCHIVE_TIMESTAMP_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "medium" };

/** Deterministic full-document render: the manifest is the only source of truth. */
export function renderSessionMarkdown(manifest: ArchiveManifest): string {
  let out = `# جلسة: ${manifest.meta.title}\n`;
  for (const [index, turn] of manifest.turns.entries()) {
    out += `\n## تمرّة ${index + 1} — ${uiText.formatDate(turn.createdAt, ARCHIVE_TIMESTAMP_FORMAT)}\n`;
    if (turn.sharedPrompt) out += `\n> ${turn.sharedPrompt}\n`;
    for (const prompt of turn.prompts.filter((p) => p.hasCustom)) {
      out += `\n> **خاص بـ ${prompt.modelId}:** ${prompt.customPrompt ?? prompt.promptText}\n`;
    }
    out += "\n";
    for (const result of turn.results) {
      out += `\n### ${resultHeading(turn, result)}\n`;
      out += "\n" + resultBody(turn, result) + "\n";
      out += "\n" + usageRow(result.usage);
    }
  }
  return out;
}

function snapshotFromData(prompt: TurnFileData["prompts"][number], sharedPrompt: string | null): TargetSnapshot {
  return {
    targetId: prompt.targetId,
    providerId: prompt.providerId,
    modelId: prompt.modelId,
    modelInfo: { id: prompt.modelId, label: prompt.modelId },
    sharedPrompt,
    customPrompt: prompt.hasCustom ? prompt.text : null,
    promptText: prompt.text,
    hasShared: prompt.hasShared,
    hasCustom: prompt.hasCustom,
  };
}

function buildArchiveTurn(data: TurnFileData, dirName: string): ArchiveTurn {
  const turnId = reqId(data.turn.id, "turn.id");
  const status = normalizeStatusMap(data.status);
  const errors = normalizeErrorMap(data.errors);
  const sharedPrompt = typeof data.turn.sharedPrompt === "string" && data.turn.sharedPrompt ? data.turn.sharedPrompt : null;
  const prompts = (data.prompts ?? []).map((p) => snapshotFromData(p, sharedPrompt));
  const attemptId = data.attemptId && data.attemptId ? data.attemptId : `legacy:${turnId}:${dirName}`;
  const attempt = data.attemptNumber && Number.isInteger(data.attemptNumber) && data.attemptNumber > 0 ? data.attemptNumber : 1;
  return {
    id: turnId,
    turnId,
    attemptId,
    attempt,
    kind: data.kind ?? "send",
    ...(data.operationId ? { operationId: data.operationId } : {}),
    dirName,
    sharedPrompt,
    prompts,
    results: normalizeArchiveResults(data.results, status, errors),
    status,
    errors,
    createdAt: reqFinite(data.createdAt, "createdAt"),
  };
}

/** Identity of an already-published attempt, used for idempotency and conflict checks. */
function payloadFingerprint(turn: ArchiveTurn): string {
  return JSON.stringify({
    turnId: turn.turnId, attemptId: turn.attemptId, attempt: turn.attempt, kind: turn.kind,
    operationId: turn.operationId ?? null, sharedPrompt: turn.sharedPrompt, prompts: turn.prompts,
    results: turn.results, status: turn.status, errors: turn.errors, createdAt: turn.createdAt,
  });
}

async function publishManifest(sink: FileSink, dir: string, manifest: ArchiveManifest): Promise<void> {
  const metaTmp = dir + "/meta.json.tmp";
  const mdTmp = dir + "/session.md.tmp";
  try {
    // session.md is presentation and is repaired from the manifest; meta.json is the
    // commit marker and is renamed last so a crash leaves the previous manifest valid.
    await sink.writeFile(mdTmp, renderSessionMarkdown(manifest));
    await sink.rename(mdTmp, dir + "/session.md");
    await sink.writeFile(metaTmp, JSON.stringify(manifest, null, 2));
    await sink.rename(metaTmp, dir + "/meta.json");
  } catch (error) {
    await sink.remove(mdTmp).catch(() => undefined);
    await sink.remove(metaTmp).catch(() => undefined);
    throw error;
  }
}

async function writeAttemptFiles(sink: FileSink, dir: string, turn: ArchiveTurn): Promise<void> {
  const base = dir + "/" + turn.dirName;
  await sink.ensureDir(base);
  if (turn.sharedPrompt) await sink.writeFile(base + "/00_shared-prompt.md", turn.sharedPrompt + "\n");
  for (const [i, prompt] of turn.prompts.entries()) {
    if (!prompt.hasCustom) continue;
    await sink.writeFile(`${base}/${resultFileName(i, prompt.providerId, prompt.modelId)}`, "## سؤال مخصص\n\n" + (prompt.customPrompt ?? prompt.promptText) + "\n");
  }
  for (const [i, result] of turn.results.entries()) {
    const prompt = turn.prompts.find((p) => p.targetId === result.targetId);
    const name = resultFileName(i, prompt?.providerId ?? "synthesis", prompt?.modelId ?? "primary");
    await sink.writeFile(`${base}/${name}`, resultBody(turn, result) + "\n\n---\n" + usageRow(result.usage));
  }
}

export async function writeSessionMeta(sink: FileSink, dir: string, meta: SessionMeta, turns: ArchiveTurn[] = []): Promise<void> {
  await runExclusiveInArchive(dir, async () => {
    // An append may already have committed a manifest: the committed one wins.
    if (await sink.exists(dir + "/meta.json")) {
      await readArchiveManifest(sink, dir);
      return;
    }
    await sink.ensureDir(dir);
    const manifest: ArchiveManifest = { schemaVersion: ARCHIVE_SCHEMA_VERSION, meta, updatedAt: meta.updatedAt, turns };
    await publishManifest(sink, dir, manifest);
  });
}

export async function appendTurn(sink: FileSink, dir: string, meta: SessionMeta, data: TurnFileData): Promise<void> {
  await runExclusiveInArchive(dir, async () => {
    const root = archiveRootOf(dir);
    const tombstones = await readDiskTombstones(sink, root);
    if (tombstones.has(meta.id)) {
      throw new ArchiveValidationError("الجلسة محذوفة على القرص — لا تُضاف محاولة جديدة");
    }
    await sink.ensureDir(dir);
    const previous = await readArchiveManifest(sink, dir);
    const turnIndex = previous ? previous.turns.length : 0;
    const dirName = `turns/${turnDirName(turnIndex)}`;
    const turn = buildArchiveTurn(data, dirName);
    if (previous) {
      const existing = previous.turns.find((entry) => entry.attemptId === turn.attemptId);
      if (existing) {
        if (payloadFingerprint(existing) === payloadFingerprint(turn)) return;
        throw new ArchiveValidationError("تعارض: محاولة بنفس المعرّف ببيانات مختلفة");
      }
    }
    const manifest: ArchiveManifest = {
      schemaVersion: ARCHIVE_SCHEMA_VERSION,
      meta: previous ? previous.meta : meta,
      updatedAt: Math.max(previous?.updatedAt ?? 0, meta.updatedAt, turn.createdAt),
      turns: [...(previous?.turns ?? []), turn],
    };
    await writeAttemptFiles(sink, dir, turn);
    await publishManifest(sink, dir, manifest);
  });
}
