import { useEffect, useState } from "react";
import { Plus, Settings, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSessionsStore } from "@/state/sessionsStore";
import { redactExternalError } from "@/lib/security/redact";
import { ar } from "@/i18n/ar";
import type { SessionMeta } from "@/types";

interface DeleteNotice { session: SessionMeta; message: string; retryable: boolean; }

export function Sidebar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { sessions, currentId, load, newSession, open, rename, remove } = useSessionsStore();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<DeleteNotice | null>(null);

  useEffect(() => { void load(); }, [load]);

  // A deletion result is a contract, not a fire-and-forget promise: an archive-cleanup
  // warning stays visible with a retry that reuses the same session identity.
  const runDelete = async (session: SessionMeta) => {
    setNotice(null);
    try {
      const result = await remove(session.id);
      if (result.warning) {
        setNotice({ session, message: result.warning, retryable: result.retryable === true });
      }
    } catch (error) {
      setNotice({ session, message: redactExternalError(error), retryable: true });
    }
  };
  return (
    <aside className="w-64 shrink-0 border-l border-sura-border bg-sura-panel flex flex-col h-full">
      <h1 className="px-2 pt-2 text-sm font-semibold">{ar.app}</h1>
      <div className="p-2 flex gap-2">
        <Button className="flex-1" onClick={() => void newSession()}><Plus className="size-4" /> {ar.newSession}</Button>
        <Button variant="ghost" size="icon" onClick={onOpenSettings} aria-label={ar.settings}><Settings className="size-4" /></Button>
      </div>
      <label className="block px-2 pb-2">
        <span className="sr-only">{ar.searchSessions}</span>
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={ar.searchSessions} />
      </label>
      {notice ? (
        <div role="alert" className="mx-2 mb-2 rounded border border-sura-danger/40 bg-sura-panel p-2 text-xs">
          <p>{notice.message}</p>
          {notice.retryable ? (
            <Button variant="ghost" size="sm" className="mt-1" onClick={() => void runDelete(notice.session)}>إعادة المحاولة</Button>
          ) : null}
        </div>
      ) : null}
      <nav className="flex-1 overflow-y-auto px-2 space-y-1">
        {sessions.filter((s) => s.title.includes(query)).map((s) => (
          <div key={s.id} className={"group flex items-center gap-1 rounded px-2 py-1.5 text-sm " + (s.id === currentId ? "bg-sura-accent/20" : "hover:bg-sura-border/40")}>
            {/* A row is a real button: Enter and Space open a session without a mouse. */}
            {editing === s.id ? (
              <Input autoFocus defaultValue={s.title} onBlur={(e) => { void rename(s.id, e.target.value.trim() || s.title); setEditing(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className="h-6 flex-1 text-xs" />
            ) : (
              <button type="button" className="flex-1 truncate text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sura-accent"
                aria-current={s.id === currentId ? "true" : undefined} onClick={() => void open(s.id)}>
                {s.title}
              </button>
            )}
            {/* Controls are revealed on hover AND on keyboard focus, never hover-only. */}
            <button type="button" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={ar.rename} onClick={() => { setEditing(s.id); setDraft(s.title); void draft; }}><Pencil className="size-3.5" /></button>
            <button type="button" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-sura-danger" aria-label={ar.delete}
              onClick={() => { if (confirm(ar.confirmDelete)) void runDelete(s); }}><Trash2 className="size-3.5" /></button>
          </div>
        ))}
      </nav>
    </aside>
  );
}