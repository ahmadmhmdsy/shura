import { useState, useRef, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { Plus, Link2, Send, Square, Sparkles, Paperclip, ChevronDown, ChevronUp, Info } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useComposerStore, EMPTY_COMPOSER_DRAFT } from "@/state/composerStore";
import { AddModelDialog } from "./AddModelDialog";
import { ContextMeter } from "./ContextMeter";
import { PROVIDERS } from "@/lib/providers/registry";
import { useSettingsStore } from "@/state/settingsStore";
import { indexDocument } from "@/lib/rag/documentManager";
import { isSupportedFileType } from "@/lib/rag/fileProcessor";
import { ar } from "@/i18n/ar";
import type { ContextMode, ModelInfo, ProviderId } from "@/types";

export interface ComposerProps {
  /** معرف الجلسة التي تنتمي إليها هذه المسودة: كل قراءة وكتابة تمر عبرها حصرًا */
  sessionId: string;
  onSend(): void; onStop(): void; onExtractSummary(): void;
  sending: boolean; cancellable?: boolean; sessionTokens: number; contextLimit: number | null;
  // [المهمة 4] وضع السياق صريح دائمًا: stateful افتراضي، وstateless لا يكون ضمنيًا أبدًا
  contextMode: ContextMode;
  onContextModeChange(next: ContextMode): void;
}

export function Composer(props: ComposerProps) {
  const sessionId = props.sessionId;
  const { targets, syncMode, sharedPrompt, customs, focusTargetId, agentMode } = useComposerStore(useShallow((s) => {
    const d = s.drafts[sessionId] ?? EMPTY_COMPOSER_DRAFT;
    return { targets: d.targets, syncMode: d.syncMode, sharedPrompt: d.sharedPrompt, customs: d.customs, focusTargetId: d.focusTargetId, agentMode: d.agentMode };
  }));
  const addTarget = useComposerStore((s) => s.addTarget);
  const removeTarget = useComposerStore((s) => s.removeTarget);
  const setShared = useComposerStore((s) => s.setShared);
  const setCustom = useComposerStore((s) => s.setCustom);
  const setSyncMode = useComposerStore((s) => s.setSyncMode);
  const setFocus = useComposerStore((s) => s.setFocus);
  const setAgentMode = useComposerStore((s) => s.setAgentMode);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { ragSettings } = useSettingsStore();

  // Keyboard shortcut: Ctrl+1-9 to focus target
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key >= "1" && event.key <= "9") {
        const index = parseInt(event.key) - 1;
        if (index < targets.length) {
          event.preventDefault();
          setFocus(sessionId, targets[index].targetId);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [targets, sessionId, setFocus]);

  const handleFileUpload = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);
    const supported = fileArray.filter((f) => isSupportedFileType(f.name));
    if (supported.length === 0) {
      toast.error("لا توجد ملفات مدعومة. الصيغ المدعومة: PDF, MD, TXT, JSON, CSV, LOG");
      return;
    }
    setUploading(true);
    try {
      for (const file of supported) {
        const persistence = ragSettings.defaultPersistence === "ask" ? "persistent" : ragSettings.defaultPersistence;
        await indexDocument(file, { persistence, settings: ragSettings });
      }
      toast.success(`تم رفع ${supported.length} ملف بنجاح`);
    } catch (error) {
      console.error("Upload failed:", error);
      toast.error("فشل رفع الملف — حاول مرة أخرى");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="border-t border-[var(--sura-border-primary)] bg-[var(--sura-surface-primary)] p-3 space-y-2" data-composer="true">
      {/* Targets row — compact chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[var(--sura-text-caption)] text-[var(--sura-text-tertiary)]" title={ar.targetHint}><Info className="size-3.5" /></span>
        {targets.map((t) => (
          <Badge key={t.targetId} variant={focusTargetId === t.targetId ? "default" : "secondary"} className="gap-1 cursor-pointer" onClick={() => setFocus(sessionId, t.targetId)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFocus(sessionId, t.targetId); } }} aria-label={`${PROVIDERS[t.providerId].label} ${t.modelId}`}>
            {PROVIDERS[t.providerId].label} · {t.modelId}
            <button aria-label="إزالة" onClick={(e) => { e.stopPropagation(); removeTarget(sessionId, t.targetId); }}>×</button>
          </Badge>
        ))}
        <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}><Plus className="size-4" /> {ar.addModel}</Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.md,.txt,.json,.csv,.log"
          className="hidden"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => void handleFileUpload(e.target.files)}
        />
        <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
          <Paperclip className="size-4" /> {uploading ? ar.ragUploading : ar.ragUploadFile}
        </Button>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[var(--sura-text-caption)] text-[var(--sura-text-tertiary)]" title={ar.contextModeHint}>
            <Switch checked={props.contextMode === "stateless"} onCheckedChange={(v) => props.onContextModeChange(v ? "stateless" : "stateful")} aria-label={ar.contextMode} />
            {props.contextMode === "stateless" ? ar.contextStateless : ar.contextStateful}
          </label>
          {ragSettings.agentMode === "toggle" && (
            <label className="flex items-center gap-1 text-xs text-sura-muted" title={ar.agentModeHint}>
              <Switch checked={agentMode} onCheckedChange={(v) => setAgentMode(sessionId, v)} aria-label={ar.agentMode} />
              {ar.agentMode}
            </label>
          )}
          <ContextMeter used={props.sessionTokens} limit={props.contextLimit} contextMode={props.contextMode} />
        </div>
      </div>

      {/* Advanced options — collapsed by default, hidden in simple mode */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex items-center gap-1 text-[var(--sura-text-caption)] text-[var(--sura-text-tertiary)] hover:text-[var(--sura-text-primary)] transition-colors"
          onClick={() => setAdvancedOpen(!advancedOpen)}
          aria-expanded={advancedOpen}
        >
          {advancedOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          {ar.advancedOptions}
        </button>
        {targets.length > 1 && (
          <>
            <span className="text-[var(--sura-text-caption)] text-[var(--sura-text-tertiary)]">·</span>
            <label className="flex items-center gap-1 text-[var(--sura-text-caption)] text-[var(--sura-text-tertiary)]" title={ar.whatIsShuraSyncDesc}><Link2 className="size-3.5" /> {ar.syncMode}
              <Switch checked={syncMode} onCheckedChange={(v) => setSyncMode(sessionId, v)} /></label>
          </>
        )}
      </div>

      {/* Advanced content — only visible when expanded */}
      {advancedOpen && (
        <div className="space-y-2 rounded-[var(--sura-radius-md)] border border-[var(--sura-border-primary)] bg-[var(--sura-surface-secondary)] p-2">
          {!syncMode && (focusTargetId
            ? targets.filter((t) => t.targetId === focusTargetId).map((t) => (
              <div key={t.targetId} className="space-y-1">
                <span className="text-[var(--sura-text-caption)] text-[var(--sura-text-tertiary)]">{ar.customField} {PROVIDERS[t.providerId].label} · {t.modelId}</span>
                <Textarea value={customs[t.targetId] ?? ""} onChange={(e) => setCustom(sessionId, t.targetId, e.target.value)} placeholder="سؤال مخصص لهذا النموذج (فارغ = يرث السؤال الموحد)" className="min-h-24" />
              </div>
            ))
            : targets.map((t) => (
              <button key={t.targetId} className="w-full text-start text-[var(--sura-text-caption)] px-2 py-1 rounded-[var(--sura-radius-sm)] border border-dashed border-[var(--sura-border-primary)] text-[var(--sura-text-tertiary)] hover:bg-[var(--sura-hover)]" onClick={() => setFocus(sessionId, t.targetId)}>
                {ar.customField} {t.modelId} {(customs[t.targetId] ?? "").length > 0 ? "✓" : "(فارغ = يرث الموحد)"}
              </button>
            ))
          )}
        </div>
      )}

      <Textarea value={sharedPrompt} onChange={(e) => setShared(sessionId, e.target.value)} placeholder={ar.sharedPlaceholder} className="min-h-20" />

      <div className="flex items-center gap-2 justify-end">
        <Button size="sm" variant="ghost" disabled={props.sending} onClick={props.onExtractSummary}><Sparkles className="size-4" /> {ar.extractSummary}</Button>
        {props.sending
          ? <Button size="sm" variant="destructive" disabled={props.cancellable === false} onClick={props.onStop}><Square className="size-4" /> {ar.stop}</Button>
          : <Button size="sm" onClick={props.onSend}><Send className="size-4" /> {ar.send}</Button>}
      </div>

      <AddModelDialog open={dialogOpen} onOpenChange={setDialogOpen}
        onPick={(p: ProviderId, m: ModelInfo) => addTarget(sessionId, { providerId: p, modelId: m.id, modelInfo: m })} />
    </div>
  );
}
