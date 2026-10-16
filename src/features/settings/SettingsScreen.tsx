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
import { ClearCustomsToggle } from "./ClearCustomsToggle";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { LogViewer } from "./LogViewer";
import { useUiText } from "@/i18n";
import type { ProviderId } from "@/types";

function CollapsibleSection({ id, title, children, defaultOpen = false }: { id: string; title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    // المرساة من المعرف الثابت لا من العنوان: العنوان يتغير مع اللغة فتنكسر المرساة عند التبديل.
    <section className="border-t border-sura-border pt-3" id={"section-" + id}>
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
  const { t } = useUiText();
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
    // النوع صريح لأن الاستدلال يثبّت العنوان على اتحاد القيم الحرفية، فيرفض إضافة عنوان جديد.
    const all: { id: string; title: string }[] = [
      { id: "providers", title: t("settings.providers") },
      { id: "primary-model", title: t("settings.primaryModel") },
      { id: "session-dir", title: t("settings.sessionDir") },
      { id: "rag-settings", title: t("rag.settings") },
      { id: "rag-files", title: t("rag.files") },
      { id: "rag-external", title: t("rag.externalFolders") },
      { id: "timeout", title: t("settings.timeout") },
      { id: "language", title: t("language.label") },
    ];
    // عارض السجل أداة تطوير: لا يُدرج في فهرس الإنتاج أصلًا.
    if (import.meta.env.DEV) all.push({ id: "dev-log", title: t("dev.log") });
    // Simple mode keeps only the essential sections in the table of contents.
    if (simpleMode) return all.filter((s) => s.id === "primary-model" || s.id === "session-dir" || s.id === "language");
    return all;
  }, [simpleMode, t]);

  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return sections;
    const q = searchQuery.toLowerCase();
    return sections.filter((s) => s.title.toLowerCase().includes(q));
  }, [sections, searchQuery]);

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("settings.title")}</DialogTitle>
          <DialogDescription className="sr-only">
            {simpleMode ? t("settings.simpleSectionsDesc") : t("settings.advancedSectionsDesc")}
          </DialogDescription>
        </DialogHeader>

        <SimpleModeToggle />
        <ClearCustomsToggle />

        <CollapsibleSection id="language" title={t("language.label")} defaultOpen={true}>
          <LanguageSwitcher />
        </CollapsibleSection>

        {!simpleMode && (
          <>
            {/* Settings search */}
            <div className="relative mb-4">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-sura-muted" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("settings.search")}
                aria-label={t("settings.search")}
                className="ps-9"
              />
            </div>

            {/* Table of contents */}
            <nav className="mb-4 p-3 rounded border border-sura-border bg-sura-panel" aria-label={t("settings.sections")}>
              <p className="text-xs font-medium text-sura-muted mb-2">{t("settings.sections")}</p>
              <div className="flex flex-wrap gap-2">
                {filteredSections.map((s) => (
                  <a
                    key={s.id}
                    href={"#section-" + s.id}
                    className="text-xs text-sura-accent hover:underline"
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById("section-" + s.id)?.scrollIntoView({ behavior: "smooth" });
                    }}
                  >
                    {s.title}
                  </a>
                ))}
              </div>
            </nav>

            <CollapsibleSection id="providers" title={t("settings.providers")} defaultOpen={true}>
              {listProviderIds().map((id) => <ProviderKeyCard key={id} id={id} />)}
            </CollapsibleSection>
          </>
        )}

        <CollapsibleSection id="primary-model" title={t("settings.primaryModel")} defaultOpen={true}>
          {/* [T5.3] Native selects cannot shrink below their widest option, so this row must be allowed to wrap:
              at 320px the two selects alone were 358px wide and forced the whole dialog to scroll sideways. */}
          <div className="flex flex-wrap gap-2">
            <select aria-label={t("settings.primaryProviderLabel")} className="bg-sura-bg border border-sura-border rounded p-2 text-sm" value={pSel} onChange={(e) => selectProvider(e.target.value as ProviderId)}>
              {listProviderIds().map((id) => <option key={id} value={id}>{PROVIDERS[id].label}</option>)}
            </select>
            <select aria-label={t("settings.primaryModelLabel")} className="bg-sura-bg border border-sura-border rounded p-2 text-sm flex-1" value={mSel} onChange={(e) => setMSel(e.target.value)}>
              <option value="">{t("settings.choose")}</option>
              {PROVIDERS[pSel].staticModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <Button size="sm" disabled={!mSel} onClick={() => void setPrimaryTarget({ providerId: pSel, modelId: mSel })}>{t("settings.set")}</Button>
          </div>
          {primaryTarget && invalidPrimary && <p role="alert" className="text-xs text-sura-warn">{t("settings.invalidPrimary")}</p>}
          {primaryTarget && !invalidPrimary && <p className="text-xs text-sura-muted">{t("settings.current", { value: primaryTarget.providerId + " · " + primaryTarget.modelId })}</p>}
          {!hasAnyTargets && <p className="text-xs text-sura-warn">{t("settings.noTargetsYet")}</p>}
        </CollapsibleSection>

        <CollapsibleSection id="session-dir" title={t("settings.sessionDir")} defaultOpen={true}>
          <Input aria-label={t("settings.sessionDir")} readOnly value={sessionRootDir ?? t("settings.sessionDirValue")} className="text-xs" />
          <p className="text-[11px] text-sura-muted">{t("settings.sessionDirFixed")}</p>
        </CollapsibleSection>

        {!simpleMode && (
          <>
            <CollapsibleSection id="rag-settings" title={t("rag.settings")}>
              <RagSettings />
            </CollapsibleSection>

            <CollapsibleSection id="rag-files" title={t("rag.files")}>
              <p className="text-xs text-sura-muted">{t("rag.filesDesc")}</p>
              <RagFileManager />
            </CollapsibleSection>

            <CollapsibleSection id="rag-external" title={t("rag.externalFolders")}>
              <p className="text-xs text-sura-muted">{t("rag.externalFoldersDesc")}</p>
              <RagFolderManager />
            </CollapsibleSection>

            <CollapsibleSection id="timeout" title={t("settings.timeout")} defaultOpen={true}>
              <Input aria-label={t("settings.timeout")} type="number" min={10} value={timeoutDraft ?? String(Math.round(timeoutMs / 1000))}
                onChange={(e) => setTimeoutDraft(e.target.value)}
                onBlur={() => {
                  if (timeoutDraft === null) return;
                  const v = Number(timeoutDraft);
                  if (timeoutDraft.trim() !== "" && Number.isFinite(v)) void setTimeoutMs(Math.max(10, Math.round(v)) * 1000);
                  setTimeoutDraft(null);
                }}
                className="w-32" />
            </CollapsibleSection>

            {import.meta.env.DEV && (
              <CollapsibleSection id="dev-log" title={t("dev.log")}>
                <LogViewer />
              </CollapsibleSection>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 border-t border-sura-border pt-3">
          <Button size="sm" onClick={() => { void load(); onClose(); }}>{t("settings.done")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}