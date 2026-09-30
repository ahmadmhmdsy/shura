import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ar } from "@/i18n/ar";
import { formatShortcut, type Shortcut } from "@/lib/keyboard/shortcuts";

interface ShortcutHelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shortcuts: Shortcut[];
}

export function ShortcutHelpDialog({ open, onOpenChange, shortcuts }: ShortcutHelpDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl" closeLabel="إغلاق">
        <DialogHeader>
          <DialogTitle>{ar.shortcutHelpTitle}</DialogTitle>
          <DialogDescription className="sr-only">{ar.shortcutHelpDesc}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-4">
          {shortcuts.map((shortcut, i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <span className="text-[var(--sura-text-body-sm)] text-[var(--sura-text-secondary)]">
                {shortcut.description}
              </span>
              <kbd className="inline-flex items-center gap-1 rounded-[var(--sura-radius-sm)] border border-[var(--sura-border-primary)] bg-[var(--sura-surface-subtle)] px-2 py-1 font-mono text-[var(--sura-text-body-sm)] text-[var(--sura-text-primary)]">
                {formatShortcut(shortcut)}
              </kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
