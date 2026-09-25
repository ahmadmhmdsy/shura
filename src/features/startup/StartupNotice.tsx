import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { StartupNotice } from "@/lib/startupRecovery";

/**
 * Recovery problems are never swallowed: this banner is the one visible warning for
 * quarantined folders, skipped deletions, and redacted recovery errors.
 */
export function StartupNoticeBanner({ notice, onDismiss }: { notice: StartupNotice; onDismiss?: () => void }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div role="alert" className="border-b border-sura-border bg-sura-panel px-3 py-2 text-sm">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <p className="font-semibold">{notice.title}</p>
          <ul className="mt-1 list-disc ps-5 text-xs text-sura-muted">
            {notice.details.map((detail, index) => <li key={index}>{detail}</li>)}
          </ul>
        </div>
        <Button variant="ghost" size="sm" onClick={() => { setDismissed(true); onDismiss?.(); }}>إخفاء</Button>
      </div>
    </div>
  );
}
