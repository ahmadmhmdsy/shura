import { useEffect, useRef, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { useSettingsStore } from "@/state/settingsStore";
import { useComposerStore } from "@/state/composerStore";
import { PROVIDERS, listProviderIds } from "@/lib/providers/registry";
import { ProviderKeyCard } from "./ProviderKeyCard";
import { RagSettings } from "@/features/rag/RagSettings";
import { RagFileManager } from "@/features/rag/RagFileManager";
import { RagFolderManager } from "@/features/rag/RagFolderManager";
import { SimpleModeToggle } from "./SimpleModeToggle";
import { ar } from "@/i18n/ar";
import type { ProviderId } from "@/types";

function CollapsibleSection({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-t border-sura-border pt-3" id={"section-" + title.replace(/s+/g, "-")}>
      <button
        type="button"
        className="flex items-center justify-between w-full text-sm font-medium text-sura-foreground mb-2 hover:text-sura-accent transition-colors"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {title}
        {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
      </button>
      {open && <div className="space-y-2">{children}</div>}
    </section>
  );
}

export function SettingsScreen({ onClose }: { onClose(): void }) {
  const { primaryTarget, setPrimaryTarget, sessionRootDir, timeoutMs, setTimeoutMs, load, simpleMode } = useSettingsStore();
  const hasAnyTargets = useComposerStore((s) => Object.values(s.drafts).some((d) => d.targets.length > 0));
  const [pSel, setPSel] = useState<ProviderId>("openrouter");
  const [mSel, setMSel] = useState("");
  const invalidPrimary = primaryTarget != null && PROVIDERS[primaryTarget.providerId]?.modelsSource === "static" && !PROVIDERS[primaryTarget.providerId]?.staticModels.some((m) => m.id === primaryTarget.modelId);
  const [timeoutDraft, setTimeoutDraft] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const openerRef = useRef<Element | null>(null);
  if (openerRef.current === null) openerRef.current = document.activeElement;
  useEffect(() => () => (openerRef.current as HTMLElement | null)?.focus(), []);

  const selectProvider = (next: ProviderId) => { setPSel(next); setMSel(""); };

  const sections = useMemo(() => {
    const all = [
      { id: "providers", title: ar.provider },
      { id: "primary-model", title: ar.primaryModel },
      { id: "session-dir", title: ar.sessionDir },
      { id: "rag-settings", title: ar.ragSettings },
      { id: "rag-files", title: ar.ragFiles },
      { id: "rag-external", title: ar.ragExternalFolders },
      { id: "timeout", title: ar.timeout },
    ];
    // Simple mode keeps only the essential sections in the table of contents.
    if (simpleMode) return all.filter((s) => s.id === "primary-model" || s.id === "session-dir");
    return all;
  }, [simpleMode]);

  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return sections;
    const q = searchQuery.toLowerCase();
    return sections.filter((s) => s.title.toLowerCase().includes(q));
  }, [sections, searchQuery]);

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" dir="rtl" closeLabel="إغلاق">
        <DialogHeader>
          <DialogTitle>{ar.settings}</DialogTitle>
          <DialogDescription className="sr-only">
            {simpleMode ? "الإعدادات الأساسية: النموذج الأساسي ومجلد الجلسات" : "إعدادات المزودين والنموذج الأساسي والمجلد والمهلة"}
          </DialogDescription>
        </DialogHeader>

        <SimpleModeToggle />

        {!simpleMode && (
          <>
            {/* Settings search */}
            <div className="relative mb-4">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-sura-muted" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={ar.searchSettings}
                aria-label={ar.searchSettings}
                className="ps-9"
              />
            </div>

            {/* Table of contents */}
            <nav className="mb-4 p-3 rounded border border-sura-border bg-sura-panel" aria-label={ar.settingsSections}>
              <p className="text-xs font-medium text-sura-muted mb-2">{ar.settingsSections}</p>
              <div className="flex flex-wrap gap-2">
                {filteredSections.map((s) => (
                  <a
                    key={s.id}
                    href={"#section-" + s.title.replace(/s+/g, "-")}
                    className="text-xs text-sura-accent hover:underline"
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById("section-" + s.title.replace(/s+/g, "-"))?.scrollIntoView({ behavior: "smooth" });
                    }}
                  >
                    {s.title}
                  </a>
                ))}
              </div>
            </nav>

            <CollapsibleSection title={ar.provider} defaultOpen={true}>
              {listProviderIds().map((id) => <ProviderKeyCard key={id} id={id} />)}
            </CollapsibleSection>
          </>
        )}

        <CollapsibleSection title={ar.primaryModel} defaultOpen={true}>
          <div className="flex gap-2">
            <select aria-label="مزود النموذج الأساسي" className="bg-sura-bg border border-sura-border rounded p-2 text-sm" value={pSel} onChange={(e) => selectProvider(e.target.value as ProviderId)}>
              {listProviderIds().map((id) => <option key={id} value={id}>{PROVIDERS[id].label}</option>)}
            </select>
            <select aria-label="نموذج الموديل الأساسي" className="bg-sura-bg border border-sura-border rounded p-2 text-sm flex-1" value={mSel} onChange={(e) => setMSel(e.target.value)}>
              <option value="">— اختر —</option>
              {PROVIDERS[pSel].staticModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <Button size="sm" disabled={!mSel} onClick={() => void setPrimaryTarget({ providerId: pSel, modelId: mSel })}>تعيين</Button>
          </div>
          {primaryTarget && invalidPrimary && <p role="alert" className="text-xs text-sura-warn">النموذج المحفوظ غير صالح: هذا الموديل لا ينتمي إلى المزود المختار.</p>}
          {primaryTarget && !invalidPrimary && <p className="text-xs text-sura-muted">الحالي: {primaryTarget.providerId} · {primaryTarget.modelId}</p>}
          {!hasAnyTargets && <p className="text-xs text-sura-warn">لم تضف نماذج بعد — الأساسي يُستخدم للخلاصة وللأدوار العادية.</p>}
        </CollapsibleSection>

        <CollapsibleSection title={ar.sessionDir} defaultOpen={true}>
          <Input aria-label={ar.sessionDir} readOnly value={sessionRootDir ?? "Documents/Shura (يعمل داخل تطبيق سطح المكتب)"} className="text-xs" />
          <p className="text-[11px] text-sura-muted">المسار ثابت في هذه النسخة: Documents/Shura</p>
        </CollapsibleSection>

        {!simpleMode && (
          <>
            <CollapsibleSection title={ar.ragSettings}>
              <RagSettings />
            </CollapsibleSection>

            <CollapsibleSection title={ar.ragFiles}>
              <p className="text-xs text-sura-muted">{ar.ragFilesDesc}</p>
              <RagFileManager />
            </CollapsibleSection>

            <CollapsibleSection title={ar.ragExternalFolders}>
              <p className="text-xs text-sura-muted">{ar.ragExternalFoldersDesc}</p>
              <RagFolderManager />
            </CollapsibleSection>

            <CollapsibleSection title={ar.timeout} defaultOpen={true}>
              <Input aria-label={ar.timeout} type="number" min={10} value={timeoutDraft ?? String(Math.round(timeoutMs / 1000))}
                onChange={(e) => setTimeoutDraft(e.target.value)}
                onBlur={() => {
                  if (timeoutDraft === null) return;
                  const v = Number(timeoutDraft);
                  if (timeoutDraft.trim() !== "" && Number.isFinite(v)) void setTimeoutMs(Math.max(10, Math.round(v)) * 1000);
                  setTimeoutDraft(null);
                }}
                className="w-32" />
            </CollapsibleSection>
          </>
        )}

        <div className="flex justify-end gap-2 border-t border-sura-border pt-3">
          <Button size="sm" onClick={() => { void load(); onClose(); }}>تم</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}