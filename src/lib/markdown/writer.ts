import type { FileSink } from "./sink";
import type { ProviderId, SessionMeta, Turn, Usage } from "@/types";

export interface TurnFileData {
  turn: Turn;
  prompts: { targetId: string; providerId: ProviderId; modelId: string; text: string; hasShared: boolean; hasCustom: boolean }[];
  results: { targetId: string; text: string; usage: Usage | null }[];
  status: Record<string, string>;
  errors: Record<string, string>;
  createdAt: number;
}

const ILLEGAL = /[<>:"/\\|?*]/g;

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

  let section = `\n\n## تمرّة ${turnIndex + 1} — ${new Date(data.createdAt).toLocaleString("ar")}\n`;
  if (data.turn.sharedPrompt) section += `\n> ${data.turn.sharedPrompt}\n`;
  for (const p of data.prompts.filter((p) => p.hasCustom)) section += `\n> **خاص بـ ${p.modelId}:** ${p.text}\n`;
  section += "\n";
  for (const r of data.results) {
    const prompt = data.prompts.find((p) => p.targetId === r.targetId)!;
    const st = data.status[r.targetId] ?? "done";
    section += `\n### ${prompt.providerId} — ${prompt.modelId}\n`;
    if (st === "error") section += `\n⛔ ${data.errors[r.targetId] ?? "خطأ"}\n`;
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
    const prompt = data.prompts.find((p) => p.targetId === r.targetId)!;
    const body = data.status[r.targetId] === "error" ? `⛔ ${data.errors[r.targetId] ?? "خطأ"}` : r.text;
    await sink.writeFile(`${dir}/${tdir}/${resultFileName(i, prompt.providerId, prompt.modelId)}`, body + "\n\n---\n" + usageRow(r.usage));
  }
  metaJson.turns.push({ ...data, dirName: tdir });
  await sink.writeFile(dir + "/meta.json", JSON.stringify(metaJson, null, 2));
}
