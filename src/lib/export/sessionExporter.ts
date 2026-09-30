import type { ChatMessage, SessionMeta } from "@/types";

/** Format an epoch-milliseconds timestamp as an ISO-8601 string for export artifacts. */
function formatTimestamp(ts: number): string {
  return new Date(ts).toISOString();
}

function messageModel(message: ChatMessage): string {
  if (message.providerId && message.modelId) return `${message.providerId}/${message.modelId}`;
  if (message.modelId) return message.modelId;
  return "—";
}

/**
 * Export a session and its messages as a Markdown document.
 *
 * Layout: a level-1 title, a metadata block, then one section per message
 * headed by its role and timestamp, followed by model/status/usage metadata
 * and the message text.
 */
export function exportSessionAsMarkdown(session: SessionMeta, messages: ChatMessage[]): string {
  const lines: string[] = [];
  lines.push(`# ${session.title}`);
  lines.push("");
  lines.push(`- **المعرف:** \`${session.id}\``);
  lines.push(`- **تاريخ الإنشاء:** ${formatTimestamp(session.createdAt)}`);
  lines.push(`- **وضع العرض:** ${session.layoutMode}`);
  const models = session.modelIds.length > 0 ? session.modelIds.join(", ") : "—";
  lines.push(`- **النماذج:** ${models}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const message of messages) {
    lines.push(`## ${message.role} — ${formatTimestamp(message.createdAt)}`);
    lines.push("");
    lines.push(`**النموذج:** ${messageModel(message)}`);
    lines.push(`**الحالة:** ${message.status}`);
    if (message.usage) {
      const cost = message.usage.costUSD == null ? "—" : `$${message.usage.costUSD.toFixed(6)}`;
      lines.push(
        `**الاستهلاك:** ${message.usage.inputTokens} مدخلات / ${message.usage.outputTokens} مخرجات / تكلفة ${cost}`,
      );
    }
    lines.push("");
    lines.push(message.text);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Export a session and its messages as a pretty-printed JSON document. The
 * full session and message objects are preserved so the file can be imported
 * or inspected later.
 */
export function exportSessionAsJSON(session: SessionMeta, messages: ChatMessage[]): string {
  return JSON.stringify(
    {
      session,
      messages,
      exportedAt: new Date().toISOString(),
    },
    null,
    2,
  );
}

/**
 * Trigger a browser download for the given text content. Creates a Blob, an
 * object URL, and a temporary anchor that is clicked and then removed.
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
