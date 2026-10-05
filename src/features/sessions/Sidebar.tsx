import { useEffect, useState } from "react";
import { Plus, Settings, Search, MessageSquare, Trash2, Edit3 } from "lucide-react";
import { toast } from "sonner";
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
  const [notice, setNotice] = useState<DeleteNotice | null>(null);

  useEffect(() => { void load(); }, [load]);

  const runDelete = async (session: SessionMeta) => {
    setNotice(null);
    try {
      const result = await remove(session.id);
      if (result.warning) {
        setNotice({ session, message: result.warning, retryable: result.retryable === true });
      } else {
        toast.success("تم حذف الجلسة");
      }
    } catch (error) {
      setNotice({ session, message: redactExternalError(error), retryable: true });
    }
  };

  const handleDelete = (session: SessionMeta) => {
    if (window.confirm(ar.confirmDelete)) {
      void runDelete(session);
    }
  };

  const filteredSessions = sessions.filter((s) => 
    s.title.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-e border-[var(--sura-sidebar-border)] bg-[var(--sura-sidebar-bg)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-[var(--sura-text-h3)] font-[var(--sura-font-bold)] text-[var(--sura-text-primary)]">
          {ar.app}
        </h1>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onOpenSettings}
          aria-label={ar.settings}
          className="text-[var(--sura-text-tertiary)] hover:text-[var(--sura-text-primary)]"
        >
          <Settings className="size-4" />
        </Button>
      </div>

      {/* Actions */}
      <div className="px-3 pb-2">
        <Button
          className="w-full justify-start gap-2"
          onClick={() => void newSession()}
        >
          <Plus className="size-4" />
          {ar.newSession}
        </Button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-[var(--sura-text-tertiary)]" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={ar.searchSessions}
            aria-label={ar.searchSessions}
            className="ps-9"
          />
        </div>
      </div>

      {/* Delete Notice */}
      {notice && (
        <div role="alert" className="mx-3 mb-2 rounded-[var(--sura-radius-md)] border border-[var(--sura-error)]/40 bg-[var(--sura-error-muted)] p-3">
          <p className="text-[var(--sura-text-body-sm)] text-[var(--sura-error)]">{notice.message}</p>
          {notice.retryable && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 text-[var(--sura-error)] hover:text-[var(--sura-error)]"
              onClick={() => void runDelete(notice.session)}
            >
              إعادة المحاولة
            </Button>
          )}
        </div>
      )}

      {/* Sessions List */}
      <nav className="flex-1 overflow-y-auto px-2 py-1" aria-label="الجلسات">
        {filteredSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <MessageSquare className="size-8 text-[var(--sura-text-tertiary)]" />
            <p className="text-[var(--sura-text-body-sm)] text-[var(--sura-text-tertiary)]">
              {query ? "لا توجد نتائج" : "لا توجد جلسات بعد"}
            </p>
            {!query && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void newSession()}
                className="text-[var(--sura-accent-primary)]"
              >
                إنشاء جلسة جديدة
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-0.5">
            {filteredSessions.map((s) => (
              <button
                key={s.id}
                type="button"
                className={cn(
                  "group relative flex w-full items-center gap-2 rounded-[var(--sura-radius-md)] px-3 py-2 text-start transition-[var(--sura-transition-all)] cursor-pointer",
                  "hover:bg-[var(--sura-sidebar-hover)]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sura-accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sura-sidebar-bg)]",
                  s.id === currentId && "bg-[var(--sura-sidebar-active)] hover:bg-[var(--sura-sidebar-active)]"
                )}
                onClick={() => void open(s.id)}
                aria-current={s.id === currentId ? "true" : undefined}
              >
                <MessageSquare className={cn(
                  "size-4 shrink-0",
                  s.id === currentId ? "text-[var(--sura-accent-primary)]" : "text-[var(--sura-text-tertiary)]"
                )} />

                <div className="flex-1 min-w-0">
                  {editing === s.id ? (
                    <input
                      type="text"
                      defaultValue={s.title}
                      autoFocus
                      onBlur={(e) => {
                        void rename(s.id, e.target.value.trim() || s.title)
                        setEditing(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                        if (e.key === "Escape") setEditing(null)
                      }}
                      className="w-full bg-transparent text-[var(--sura-text-body-sm)] font-[var(--sura-font-medium)] outline-none border-b border-[var(--sura-accent-primary)]"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <p className={cn(
                      "truncate text-[var(--sura-text-body-sm)] font-[var(--sura-font-medium)]",
                      s.id === currentId ? "text-[var(--sura-text-primary)]" : "text-[var(--sura-text-secondary)]"
                    )}>
                      {s.title}
                    </p>
                  )}
                </div>

                <div className={cn(
                  "flex items-center gap-0.5",
                  "opacity-0 group-hover:opacity-100 transition-opacity"
                )}>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="size-6"
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditing(s.id)
                    }}
                    aria-label={ar.rename}
                  >
                    <Edit3 className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="size-6 text-[var(--sura-error)] hover:text-[var(--sura-error)]"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(s)
                    }}
                    aria-label={ar.delete}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              </button>
            ))}
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="border-t border-[var(--sura-sidebar-border)] px-3 py-2">
        <p className="text-[var(--sura-text-caption)] text-[var(--sura-text-tertiary)]">
          {sessions.length} جلسة
        </p>
      </div>
    </aside>
  );
}

function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(" ");
}
