import { useSessionsStore } from "@/state/sessionsStore";

/**
 * A single polite live region for turn status (streaming, stopped, error, done).
 *
 * Model output is never announced: reading a whole response aloud would be hostile.
 * Only the state changes are, so a screen-reader user knows work is happening and when
 * it finished or failed.
 */
export function StatusAnnouncer() {
  const messages = useSessionsStore((s) => s.messages);
  const loading = useSessionsStore((s) => s.loading);
  const last = messages.length > 0 ? messages[messages.length - 1] : null;
  const status = last?.status;

  let text = "";
  if (loading) text = "جارٍ تحميل الجلسة";
  else if (status === "streaming" || status === "pending") text = "جارٍ توليد الرد";
  else if (status === "stopped") text = "أُوقف التوليد";
  else if (status === "error") text = "فشل التوليد: " + (last?.error ?? "خطأ غير معروف");
  else if (status === "done") text = "انتهى الرد";

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {text}
    </div>
  );
}
