import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { getLogBuffer, getMetrics, type LogEntry, type RunMetrics } from "@/lib/logging";
import { uiText, useUiText } from "@/i18n";

type LevelFilter = LogEntry["level"] | "all";

const LEVELS: LevelFilter[] = ["all", "debug", "info", "warn", "error"];

// ألوان من لوحة Tailwind الافتراضية: رموز sura-* في هذا المشروع غير معلنة في
// @theme فهي لا تولّد أي CSS (انظر تقرير المراجعة §9).
const LEVEL_CLASS: Record<LogEntry["level"], string> = {
  debug: "text-muted-foreground",
  info: "text-primary",
  warn: "text-amber-600",
  error: "text-destructive",
};

export interface LogSnapshot {
  entries: LogEntry[];
  metrics: RunMetrics;
}

function defaultRead(): LogSnapshot {
  return { entries: getLogBuffer(), metrics: getMetrics() };
}

function formatTime(timestamp: number): string {
  return uiText.formatDate(timestamp, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function formatUptime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0
    ? uiText.t("dev.uptimeMinutes", { minutes, seconds })
    : uiText.t("dev.uptimeSeconds", { seconds });
}

/**
 * عارض سجل التشغيل — أداة تطوير تُعرض في الإعدادات في وضع التطوير فقط.
 *
 * يقرأ من الحلقة الدائرية في logging.ts (آخر ١٠٠ رسالة) ومن مقاييس الجولة.
 * السجل لا يبثّ تغييرات، فاللوحة تستطلع كل ثانية ما دامت مفتوحة.
 *
 * المصدر قابل للحقن ليُختبر العرض دون لمس الحالة العامة للوحدة.
 */
export function LogViewer({ read = defaultRead }: { read?: () => LogSnapshot } = {}) {
  const { t } = useUiText();
  const levelLabel: Record<LogEntry["level"], string> = {
    debug: t("dev.levelDebug"),
    info: t("dev.levelInfo"),
    warn: t("dev.levelWarn"),
    error: t("dev.levelError"),
  };
  const [snapshot, setSnapshot] = useState(() => ({ ...read(), now: Date.now() }));
  const [level, setLevel] = useState<LevelFilter>("all");

  const refresh = useCallback(() => setSnapshot({ ...read(), now: Date.now() }), [read]);

  useEffect(() => {
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, [refresh]);

  const shown = level === "all" ? snapshot.entries : snapshot.entries.filter((e) => e.level === level);
  const newestFirst = [...shown].reverse();

  return (
    <div className="space-y-3 text-xs">
      <p className="text-muted-foreground">{t("dev.logDesc")}</p>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label={t("dev.sessions")} value={snapshot.metrics.sessionCount} />
        <Metric label={t("dev.messages")} value={snapshot.metrics.messageCount} />
        <Metric label={t("dev.errors")} value={snapshot.metrics.errorCount} />
        <Metric label={t("dev.uptime")} value={formatUptime(snapshot.now - snapshot.metrics.appStartTime)} />
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-muted-foreground" htmlFor="log-level-filter">{t("dev.level")}</label>
        <select
          id="log-level-filter"
          className="bg-background border border-border rounded p-1"
          value={level}
          onChange={(e) => setLevel(e.target.value as LevelFilter)}
        >
          {LEVELS.map((l) => (
            <option key={l} value={l}>{l === "all" ? t("dev.all") : levelLabel[l]}</option>
          ))}
        </select>
        <Button size="sm" variant="outline" onClick={refresh}>{t("dev.refresh")}</Button>
        <span className="text-muted-foreground">{shown.length} / {snapshot.entries.length}</span>
      </div>

      {newestFirst.length === 0 ? (
        <p className="text-muted-foreground">{t("dev.empty")}</p>
      ) : (
        <ol
          className="max-h-64 divide-y divide-border overflow-y-auto rounded border border-border"
          data-testid="log-entries"
        >
          {newestFirst.map((entry, i) => (
            <li key={`${entry.timestamp}-${i}`} className="p-2 font-mono text-[11px] leading-relaxed">
              <span className="text-muted-foreground">{formatTime(entry.timestamp)}</span>{" "}
              <span className={LEVEL_CLASS[entry.level]}>[{levelLabel[entry.level]}]</span>{" "}
              <span className="text-foreground">{entry.message}</span>
              {entry.error ? <span className="text-destructive"> — {entry.error.message}</span> : null}
              {entry.context ? (
                <pre className="mt-1 whitespace-pre-wrap break-all text-muted-foreground">
                  {JSON.stringify(entry.context)}
                </pre>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded border border-border p-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}
