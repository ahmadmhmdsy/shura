import type { ModelMessage } from "ai";
import type { ChatMessage, ContextMode } from "@/types";
import { estimateTokens } from "@/lib/tokens/estimate";
import { KeyedError } from "@/lib/errors/keyedError";

type TextRow = { text: string };

export function buildContextMessages(
  history: readonly ChatMessage[], currentPrompt: string, mode: ContextMode, contextLength: number,
): ModelMessage[] {
  if (!Number.isFinite(contextLength) || contextLength <= 0) throw new KeyedError("errors.invalidContextLength");
  const estimate = (rows: readonly TextRow[]): number =>
    Math.ceil(rows.reduce((sum, row) => sum + estimateTokens(row.text), 0));
  const current: ModelMessage = { role: "user", content: currentPrompt };
  if (estimate([{ text: currentPrompt }]) > contextLength * 0.8) throw new KeyedError("errors.contextOverflow", { max: contextLength });
  if (mode === "stateless") return [current];

  const groups = new Map<string, ChatMessage[]>();
  for (const row of history) {
    if (row.superseded || row.status !== "done" || !row.text.trim()) continue;
    const group = groups.get(row.turnId) ?? [];
    group.push(row);
    groups.set(row.turnId, group);
  }
  const complete = [...groups.values()]
    .filter((rows) => rows.some((row) => row.role === "user") && rows.some((row) => row.role === "assistant"))
    .map((rows) => [...rows].sort((a, b) => a.createdAt - b.createdAt))
    .sort((a, b) => Math.min(...a.map((row) => row.createdAt)) - Math.min(...b.map((row) => row.createdAt)));
  while (complete.length > 0) {
    const rows: TextRow[] = complete.flat().map((row) => ({ text: row.text }));
    if (estimate([...rows, { text: currentPrompt }]) <= contextLength * 0.8) break;
    complete.shift();
  }
  return [...complete.flat().map((row) => ({ role: row.role, content: row.text })), current];
}
