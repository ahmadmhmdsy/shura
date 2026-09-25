import type { FileSink } from "./sink";
import type { ProviderId, SessionMeta, Turn, Usage } from "@/types";

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
}

const ILLEGAL = /[<>:"/\\|?*]/g;
const ARCHIVE_ERROR_MAX_CHARS = 512;
const ARCHIVE_ERROR_TRUNCATION_MARKER = "… [مقتطع]";

// [المهمة 5] حد واحد يشمل المسافات والعلامة، ويضمن تطابق الخطأ في Markdown والملف الفرعي وmeta.json.
function boundArchiveError(error: string | undefined): string {
  const normalized = (error ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const chars = [...normalized];
  const marker = [...ARCHIVE_ERROR_TRUNCATION_MARKER];
  if (chars.length <= ARCHIVE_ERROR_MAX_CHARS) return normalized;
  return chars.slice(0, ARCHIVE_ERROR_MAX_CHARS - marker.length).join("") + ARCHIVE_ERROR_TRUNCATION_MARKER;
}

export function sanitizeTitle(title: string): string {
  // C0 control chars (U+0000-U+001F) are filtered out directly: an explicit control range
  // inside a regex literal is rejected by eslint's no-control-regex.
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
  const cost = u.costUSD == null ? "—" : "$" + u.costUSD.toFixed(6);
  return `| المدخلات | ${u.inputTokens} |\n| المخرجات | ${u.outputTokens} |\n| الكاش | ${u.cachedInputTokens} |\n| التكلفة | ${cost} |\n`;
}

function pad2(n: number): string { return String(n).padStart(2, "0"); }

export function turnDirName(turnIndex: number): string {
  return `t${pad2(turnIndex + 1)}`;
}

export function resultFileName(index: number, providerId: string, modelId: string): string {
  return `${pad2(index + 1)}_${providerId}__${modelId.replace(/[^\w.-]/g, "_")}.md`;
}

export async function writeSessionMeta(sink: FileSink, dir: string, meta: SessionMeta, turns: unknown[] = []): Promise<void> {
  await sink.ensureDir(dir);
  await sink.writeFile(dir + "/meta.json", JSON.stringify({ meta, turns }, null, 2));
}

export async function appendTurn(sink: FileSink, dir: string, meta: SessionMeta, data: TurnFileData): Promise<void> {
  await sink.ensureDir(dir);
  const existing = (await sink.exists(dir + "/session.md")) ? await sink.readFile(dir + "/session.md") : "";
  const content = existing || `# جلسة: ${meta.title}\n`;
  const metaJson = (await sink.exists(dir + "/meta.json")) ? JSON.parse(await sink.readFile(dir + "/meta.json")) : { meta, turns: [] };
  const turnIndex = metaJson.turns.length;
  const tdir = `turns/${turnDirName(turnIndex)}`;
  const archiveErrors = Object.fromEntries(
    Object.entries(data.errors).map(([targetId, error]) => [targetId, boundArchiveError(error)]),
  );
  const errorText = (targetId: string): string => archiveErrors[targetId] ?? "خطأ";

  let section = `\n\n## تمرّة ${turnIndex + 1} — ${new Date(data.createdAt).toLocaleString("ar")}\n`;
  if (data.turn.sharedPrompt) section += `\n> ${data.turn.sharedPrompt}\n`;
  for (const p of data.prompts.filter((p) => p.hasCustom)) section += `\n> **خاص بـ ${p.modelId}:** ${p.text}\n`;
  section += "\n";
  for (const r of data.results) {
    // [دور إصلاح مأذون — بند 1 من دور الإصلاح الثاني] تمريرة الخلاصة: نتائج بلا مدخل prompt
    // مطابق (عقد الأرشفة الجديد: النص في sharedPrompt والنتيجة بلا prompts) — تسمية بديلة مقروءة
    // بدل الانهيار على undefined (كان `find(...)!` يرمي TypeError في هذا الشكل).
    const prompt = data.prompts.find((p) => p.targetId === r.targetId);
    const st = data.status[r.targetId] ?? "done";
    section += `\n### ${prompt ? `${prompt.providerId} — ${prompt.modelId}` : "خلاصة النموذج الأساسي (synthesis)"}\n`;
    // [-المهمة 5] خطأ بنص جزئي: النص يُحفظ ويُظهر الخطأ المحدود بجانبه — لا استبدال
    if (st === "error" && r.text.trim()) section += `\n${r.text}\n\n⛔ ${errorText(r.targetId)}\n`;
    else if (st === "error") section += `\n⛔ ${errorText(r.targetId)}\n`;
    else section += `\n${r.text}\n`;
    section += "\n" + usageRow(r.usage);
  }

  await sink.writeFile(dir + "/session.md", content + section);
  await sink.ensureDir(`${dir}/${tdir}`);
  if (data.turn.sharedPrompt) await sink.writeFile(`${dir}/${tdir}/00_shared-prompt.md`, data.turn.sharedPrompt + "\n");
  for (const [i, p] of data.prompts.entries()) {
    if (!p.hasCustom) continue;
    await sink.writeFile(`${dir}/${tdir}/${resultFileName(i, p.providerId, p.modelId)}`, "## سؤال مخصص\n\n" + p.text + "\n");
  }
  for (const [i, r] of data.results.entries()) {
    const prompt = data.prompts.find((p) => p.targetId === r.targetId);
    const body = data.status[r.targetId] === "error" && r.text.trim()
      ? r.text + "\n\n⛔ " + errorText(r.targetId)
      : data.status[r.targetId] === "error" ? `⛔ ${errorText(r.targetId)}` : r.text;
    await sink.writeFile(`${dir}/${tdir}/${resultFileName(i, prompt?.providerId ?? "synthesis", prompt?.modelId ?? "primary")}`, body + "\n\n---\n" + usageRow(r.usage));
  }
  metaJson.turns.push({ ...data, errors: archiveErrors, dirName: tdir });
  await sink.writeFile(dir + "/meta.json", JSON.stringify(metaJson, null, 2));
}
