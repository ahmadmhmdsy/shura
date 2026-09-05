import { useEffect, useState } from "react";
import { Plus, Settings, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSessionsStore } from "@/state/sessionsStore";
import { ar } from "@/i18n/ar";

export function Sidebar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { sessions, currentId, load, newSession, open, rename, remove } = useSessionsStore();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => { void load(); }, [load]);

  return (
    <aside className="w-64 shrink-0 border-l border-sura-border bg-sura-panel flex flex-col h-full">
      <h1 className="px-2 pt-2 text-sm font-semibold">{ar.app}</h1>
      <div className="p-2 flex gap-2">
        <Button className="flex-1" onClick={() => void newSession()}><Plus className="size-4" /> {ar.newSession}</Button>
        <Button variant="ghost" size="icon" onClick={onOpenSettings} aria-label={ar.settings}><Settings className="size-4" /></Button>
      </div>
      <div className="px-2 pb-2"><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={ar.searchSessions} /></div>
      <nav className="flex-1 overflow-y-auto px-2 space-y-1">
        {sessions.filter((s) => s.title.includes(query)).map((s) => (
          <div key={s.id} className={"group flex items-center gap-1 rounded px-2 py-1.5 cursor-pointer text-sm " + (s.id === currentId ? "bg-sura-accent/20" : "hover:bg-sura-border/40")}
            onClick={() => { if (editing !== s.id) void open(s.id); }}>
            {editing === s.id ? (
              <Input autoFocus defaultValue={s.title} onBlur={(e) => { void rename(s.id, e.target.value.trim() || s.title); setEditing(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className="h-6 text-xs" />
            ) : (
              <span className="flex-1 truncate" title={s.title}>{s.title}</span>
            )}
            <button className="opacity-0 group-hover:opacity-100" aria-label={ar.rename} onClick={(e) => { e.stopPropagation(); setEditing(s.id); setDraft(s.title); void draft; }}><Pencil className="size-3.5" /></button>
            <button className="opacity-0 group-hover:opacity-100 text-sura-danger" aria-label={ar.delete}
              onClick={(e) => { e.stopPropagation(); if (confirm(ar.confirmDelete)) void remove(s.id); }}><Trash2 className="size-3.5" /></button>
          </div>
        ))}
      </nav>
    </aside>
  );
}
