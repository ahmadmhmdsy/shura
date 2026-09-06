import type { FileSink } from "./sink";
import type { ChatMessage, ProviderId, SessionMeta, UsageEvent } from "@/types";

export interface RestoredSession { meta: SessionMeta; messages: ChatMessage[]; usageEvents: UsageEvent[]; }

export async function importSessionFromDisk(sink: FileSink, dir: string): Promise<RestoredSession> {
  const raw = JSON.parse(await sink.readFile(dir + "/meta.json"));
  const meta: SessionMeta = { ...raw.meta, onDisk: true };
  const messages: ChatMessage[] = [];
  const usageEvents: UsageEvent[] = [];
  for (const t of raw.turns ?? []) {
    // [دور إصلاح مأذون — بند 1 من دور الإصلاح الثاني] تمريرة الخلاصة (id يبدأ syn-): بلا مدخلات
    // prompts ونتيجة واحدة نصها الخلاصة — تعاد بناءها برسالة kind="synthesis" بنصها وحالتها
    // واستهلاكها حتى تظهر عند فقدان القاعدة (الحلقة العامة كانت تنهار على prompt المفقود).
    if (String(t.turn?.id ?? "").startsWith("syn-")) {
      for (const r of t.results ?? []) {
        const st = (t.status?.[r.targetId] ?? "done") as ChatMessage["status"];
        messages.push({ id: t.turn.id + ":" + r.targetId, sessionId: meta.id, turnId: t.turn.id, createdAt: t.createdAt, role: "assistant", kind: "synthesis", text: r.text, status: st === "error" ? "error" : st, error: t.errors?.[r.targetId], usage: r.usage ?? undefined });
      }
      continue;
    }
    const shared = (t.prompts ?? []).find((p: { hasShared: boolean }) => p.hasShared);
    if (shared) {
      messages.push({ id: t.turn.id + ":shared", sessionId: meta.id, turnId: t.turn.id, createdAt: t.createdAt, role: "user", kind: "prompt", text: shared.text, promptKind: "shared", status: "done" });
    }
    for (const p of t.prompts ?? []) {
      if (p.hasCustom) messages.push({ id: t.turn.id + ":" + p.targetId + ":custom", sessionId: meta.id, turnId: t.turn.id, createdAt: t.createdAt + 1, role: "user", kind: "prompt", text: p.text, targetId: p.targetId, promptKind: "custom", status: "done" });
    }
    for (const r of t.results ?? []) {
      const p = (t.prompts ?? []).find((p: { targetId: string }) => p.targetId === r.targetId)!;
      const st = (t.status?.[r.targetId] ?? "done") as ChatMessage["status"];
      messages.push({ id: t.turn.id + ":" + r.targetId, sessionId: meta.id, turnId: t.turn.id, createdAt: t.createdAt + 2, role: "assistant", kind: "result", text: r.text, providerId: p.providerId as ProviderId, modelId: p.modelId, targetId: r.targetId, status: st === "error" ? "error" : st, error: t.errors?.[r.targetId], usage: r.usage ?? undefined });
      if (r.usage) usageEvents.push({ id: t.turn.id + ":" + r.targetId, sessionId: meta.id, turnId: t.turn.id, ts: t.createdAt, providerId: p.providerId as ProviderId, modelId: p.modelId, inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, cachedInputTokens: r.usage.cachedInputTokens, costUSD: r.usage.costUSD, toolCalls: 0, durationMs: 0, status: st === "error" ? "error" : "ok" });
    }
  }
  return { meta, messages, usageEvents };
}

export async function recoverFromDisk(sink: FileSink, rootDir: string): Promise<RestoredSession[]> {
  const names = await sink.readDir(rootDir).catch(() => []);
  const out: RestoredSession[] = [];
  for (const n of names) {
    const dir = rootDir.replace(/\/+$/, "") + "/" + n;
    try { out.push(await importSessionFromDisk(sink, dir)); } catch { /* مجلد بلا meta.json — تجاوز */ }
  }
  return out;
}
