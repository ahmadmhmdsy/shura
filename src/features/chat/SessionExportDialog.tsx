import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { exportSessionAsJSON, exportSessionAsMarkdown, downloadFile } from "@/lib/export/sessionExporter";
import { useUiText } from "@/i18n";
import type { ChatMessage, SessionMeta } from "@/types";

type ExportFormat = "markdown" | "json";
type MessageRange = "all" | "prompts" | "results";

const FORMAT_VALUES: ExportFormat[] = ["markdown", "json"];
const RANGE_VALUES: MessageRange[] = ["all", "prompts", "results"];

/** Strip characters that are invalid in file names on Windows/macOS/Linux. */
function safeFilename(title: string): string {
  const base = title.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-");
  return base || "session";
}

export function SessionExportDialog({ open, onOpenChange, session, messages }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: SessionMeta;
  messages: ChatMessage[];
}) {
  const { t, plural } = useUiText();
  const formatLabel: Record<ExportFormat, string> = {
    markdown: t("exportDialog.formatMarkdown"),
    json: t("exportDialog.formatJSON"),
  };
  const rangeLabel: Record<MessageRange, string> = {
    all: t("exportDialog.rangeAll"),
    prompts: t("exportDialog.rangePrompts"),
    results: t("exportDialog.rangeResults"),
  };
  const [format, setFormat] = useState<ExportFormat>("markdown");
  const [range, setRange] = useState<MessageRange>("all");

  // Reset on close so reopening starts from the defaults and a previous export
  // never leaks into the next one.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setFormat("markdown");
      setRange("all");
    }
    onOpenChange(next);
  };

  const rangeMessages = useMemo(() => {
    if (range === "prompts") return messages.filter((message) => message.role === "user");
    if (range === "results") return messages.filter((message) => message.role === "assistant");
    return messages;
  }, [messages, range]);

  const handleExport = () => {
    const filename = `${safeFilename(session.title)}.${format === "markdown" ? "md" : "json"}`;
    const content = format === "markdown"
      ? exportSessionAsMarkdown(session, rangeMessages)
      : exportSessionAsJSON(session, rangeMessages);
    downloadFile(content, filename, format === "markdown" ? "text/markdown" : "application/json");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("exportDialog.title")}</DialogTitle>
          <DialogDescription>{t("exportDialog.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <fieldset>
            <legend className="text-sm font-medium mb-2">{t("exportDialog.format")}</legend>
            <div className="flex flex-wrap gap-4">
              {FORMAT_VALUES.map((value) => (
                <label key={value} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="export-format"
                    value={value}
                    checked={format === value}
                    onChange={() => setFormat(value)}
                    className="size-4 accent-[var(--sura-accent-primary)]"
                  />
                  {formatLabel[value]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-medium mb-2">{t("exportDialog.range")}</legend>
            <div className="flex flex-wrap gap-4">
              {RANGE_VALUES.map((value) => (
                <label key={value} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="export-range"
                    value={value}
                    checked={range === value}
                    onChange={() => setRange(value)}
                    className="size-4 accent-[var(--sura-accent-primary)]"
                  />
                  {rangeLabel[value]}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-xs text-sura-muted" role="status">
            {plural("exportDialog.count", rangeMessages.length)}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button onClick={handleExport} disabled={rangeMessages.length === 0}>
            <Download className="size-4" />
            {t("exportDialog.button")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
