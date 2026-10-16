import { useSessionsStore } from "@/state/sessionsStore";
import { useUiText } from "@/i18n";
import { messageErrorText } from "@/lib/chat/messageError";

/**
 * A single polite live region for turn status (streaming, stopped, error, done).
 *
 * Model output is never announced: reading a whole response aloud would be hostile.
 * Only the state changes are, so a screen-reader user knows work is happening and when
 * it finished or failed.
 */
export function StatusAnnouncer() {
  const { t } = useUiText();
  const messages = useSessionsStore((s) => s.messages);
  const loading = useSessionsStore((s) => s.loading);
  const last = messages.length > 0 ? messages[messages.length - 1] : null;
  const status = last?.status;

  let text = "";
  if (loading) text = t("chat.status.loadingSession");
  else if (status === "streaming" || status === "pending") text = t("chat.status.generating");
  else if (status === "stopped") text = t("chat.status.generationStopped");
  else if (status === "truncated") text = t("chat.status.generationTruncated");
  else if (status === "error") text = t("chat.status.generationFailed", { reason: last?.error ? messageErrorText(t, last.error) : t("chat.unknownError") });
  else if (status === "done") text = t("chat.status.generationDone");

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {text}
    </div>
  );
}
