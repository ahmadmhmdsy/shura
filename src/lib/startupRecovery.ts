import { recoverFromDisk, type RecoveryReport, type RestoredSession } from "@/lib/markdown/parser";
import type { FileSink } from "@/lib/markdown/sink";
import { redactExternalError } from "@/lib/security/redact";

export interface StartupNotice {
  title: string;
  details: string[];
}

export interface ImportPayload {
  meta: RestoredSession["meta"];
  messages: RestoredSession["messages"];
  turns: RestoredSession["turns"];
  usageEvents: RestoredSession["usageEvents"];
}

export interface RecoverSessionsDeps {
  sink: FileSink | null;
  rootDir: string;
  filePersistActive: boolean;
  existingSessionCount: () => number;
  isTombstoned: (id: string) => Promise<boolean>;
  importSession: (payload: ImportPayload) => Promise<"imported" | "tombstoned">;
  onImported: () => Promise<void> | void;
}

const EMPTY_REPORT: RecoveryReport = { imported: [], quarantined: [], skippedTombstoned: [], errors: [] };

/**
 * Startup recovery: one atomic import per recovered session (including its turn table),
 * with every skip, quarantine, and failure surfaced instead of swallowed.
 */
export async function recoverSessionsFromDisk(deps: RecoverSessionsDeps): Promise<RecoveryReport> {
  if (!deps.filePersistActive || !deps.sink || !deps.rootDir) return EMPTY_REPORT;
  if (deps.existingSessionCount() !== 0) return EMPTY_REPORT;
  const report = await recoverFromDisk(deps.sink, deps.rootDir, {
    isTombstoned: deps.isTombstoned,
  });
  const imported: RestoredSession[] = [];
  for (const session of report.imported) {
    try {
      const result = await deps.importSession({
        meta: session.meta,
        messages: session.messages,
        turns: session.turns,
        usageEvents: session.usageEvents,
      });
      if (result === "tombstoned") {
        report.skippedTombstoned.push(session.meta.id);
        continue;
      }
      imported.push(session);
    } catch (error) {
      report.errors.push("تعذر استيراد جلسة مستعادة: " + redactExternalError(error));
    }
  }
  report.imported = imported;
  if (imported.length > 0) await deps.onImported();
  return report;
}

/** One dismissible warning built from anything that was not a clean recovery. */
export function noticeFromRecoveryReport(report: RecoveryReport): StartupNotice | null {
  const details: string[] = [];
  for (const entry of report.quarantined) {
    details.push("عُزل أرشيف تالف: " + entry.dir + " (" + entry.reason + ")");
  }
  for (const id of report.skippedTombstoned) {
    details.push("تم تجاوز جلسة محذوفة: " + id);
  }
  for (const error of report.errors) details.push(error);
  if (!details.length) return null;
  return { title: "تقرير استرجاع الأرشيف", details };
}
