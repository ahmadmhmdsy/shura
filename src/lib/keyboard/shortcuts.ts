export interface Shortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
  description: string;
  when?: () => boolean;
}

export function isShortcutMatch(event: KeyboardEvent, shortcut: Shortcut): boolean {
  if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) return false;

  const ctrlMatch = shortcut.ctrl
    ? event.ctrlKey || event.metaKey
    : !event.ctrlKey && !event.metaKey;
  if (!ctrlMatch) return false;

  const altMatch = shortcut.alt ? event.altKey : !event.altKey;
  if (!altMatch) return false;

  // For shift: check unless the key is '?' (which inherently requires shift
  // on most layouts). This ensures Ctrl+K does not match Ctrl+Shift+K.
  if (shortcut.key !== "?") {
    const shiftMatch = shortcut.shift ? event.shiftKey : !event.shiftKey;
    if (!shiftMatch) return false;
  }

  return true;
}

export function registerShortcuts(shortcuts: Shortcut[]): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    for (const shortcut of shortcuts) {
      if (isShortcutMatch(event, shortcut)) {
        if (shortcut.when && !shortcut.when()) continue;
        event.preventDefault();
        shortcut.action();
        return;
      }
    }
  };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}

export function formatShortcut(shortcut: Shortcut): string {
  const parts: string[] = [];
  if (shortcut.ctrl) parts.push("Ctrl");
  if (shortcut.shift) parts.push("Shift");
  if (shortcut.alt) parts.push("Alt");
  const key = shortcut.key === "Escape" ? "Esc" : shortcut.key === "?" ? "?" : shortcut.key.toUpperCase();
  parts.push(key);
  return parts.join("+");
}
