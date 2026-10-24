import { useState, useRef, useEffect, type Ref } from "react";
import { useShallow } from "zustand/react/shallow";
import { Plus, Link2, Send, Square, Sparkles, Paperclip, ChevronDown, ChevronUp, Info } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { badgeVariants } from "@/components/ui/badge";
import { useComposerStore, EMPTY_COMPOSER_DRAFT } from "@/state/composerStore";
import { AddModelDialog } from "./AddModelDialog";
import { ContextMeter } from "./ContextMeter";
import { PROVIDERS } from "@/lib/providers/registry";
import { useSettingsStore } from "@/state/settingsStore";
import { indexDocument } from "@/lib/rag/documentManager";
import { isSupportedFileType } from "@/lib/rag/fileProcessor";
import { LIMITS } from "@/lib/limits";
import { useUiText } from "@/i18n";
import type { ContextMode, ModelInfo, ProviderId } from "@/types";

export interface ComposerProps {
  /** معرف الجلسة التي تنتمي إليها هذه المسودة: كل قراءة وكتابة تمر عبرها حصرًا */
  sessionId: string;
  onSend(): void; onStop(): void; onExtractSummary(): void;
  sending: boolean; cancellable?: boolean; sessionTokens: number; contextLimit: number | null;
  /** [T2.5/NL-02] الحد مفترض لا منشور: يمرّ إلى المقياس ليوسم الرقم بدل تقديمه كحقيقة. */
  contextAssumed?: boolean;
  // [المهمة 4] وضع السياق صريح دائمًا: stateful افتراضي، وstateless لا يكون ضمنيًا أبدًا
  contextMode: ContextMode;
  onContextModeChange(next: ContextMode): void;
  /** مرجع حقل النص المشترك: يُرجَع التركيز إليه بعد الإرسال لمتابعة الكتابة. */
  ref?: Ref<HTMLTextAreaElement>;
}

export function Composer({ ref, ...props }: ComposerProps) {
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
  const { t, plural, formatNumber } = useUiText();

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
      toast.error(t("rag.unsupportedFiles"));
      return;
    }
    setUploading(true);
    try {
      for (const file of supported) {
        const persistence = ragSettings.defaultPersistence === "ask" ? "persistent" : ragSettings.defaultPersistence;
        await indexDocument(file, { persistence, settings: ragSettings });
      }
      toast.success(plural("chat.uploaded", supported.length));
    } catch (error) {
      console.error("Upload failed:", error);
      toast.error(t("chat.uploadFailed"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Escape empties the field instead of doing nothing, and offers an undo. It stays inert
  // while a send is streaming: there Escape is already the stop shortcut (useChatShortcuts),
  // and wiping the draft at the same moment would be a surprise, not a convenience.
  const handleSharedKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Escape" || props.sending || sharedPrompt.length === 0) return;
    event.preventDefault();
    const cleared = sharedPrompt;
    setShared(sessionId, "");
    toast(t("chat.draftCleared"), {
      action: { label: t("common.undo"), onClick: () => setShared(sessionId, cleared) },
    });
  };

  return (
    <div className="border-t border-[var(--sura-border-primary)] bg-[var(--sura-surface-primary)] p-3 space-y-2" data-composer="true">
      {/* Targets row — compact chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[length:var(--sura-text-caption)] text-[var(--sura-text-tertiary)]" title={t("chat.targetHint")} aria-hidden="true"><Info className="size-3.5" /></span>
        {/* الشريحة زرّان شقيقان داخل إطار واحد: التركيز على النموذج، وإزالته. لا يجوز أن يحوي
            أحدهما الآخر — فالتداخل يُخفي الإزالة عن قارئ الشاشة ويصادره axe كـ
            nested-interactive. الإطار نفسه غير تفاعلي. */}
        {targets.map((target) => (
          <div
            key={target.targetId}
            className={badgeVariants({ variant: focusTargetId === target.targetId ? "default" : "secondary" })}
          >
            <button
              type="button"
              className="cursor-pointer"
              onClick={() => setFocus(sessionId, target.targetId)}
              aria-label={`${PROVIDERS[target.providerId].label} ${target.modelId}`}
              aria-pressed={focusTargetId === target.targetId}
            >
              {PROVIDERS[target.providerId].label} · {target.modelId}
            </button>
            <button
              type="button"
              className="cursor-pointer"
              aria-label={t("common.remove")}
              onClick={() => removeTarget(sessionId, target.targetId)}
            >
              ×
            </button>
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}><Plus className="size-4" /> {t("chat.addModel")}</Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.md,.txt,.json,.csv,.log"
          className="hidden"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => void handleFileUpload(e.target.files)}
        />
        <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
          <Paperclip className="size-4" /> {uploading ? t("rag.uploading") : t("rag.uploadFile")}
        </Button>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[length:var(--sura-text-caption)] text-[var(--sura-text-tertiary)]" title={t("chat.contextModeHint")}>
            <Switch checked={props.contextMode === "stateless"} onCheckedChange={(v) => props.onContextModeChange(v ? "stateless" : "stateful")} aria-label={t("chat.contextMode")} />
            {props.contextMode === "stateless" ? t("chat.contextStateless") : t("chat.contextStateful")}
          </label>
          {ragSettings.agentMode === "toggle" && (
            <label className="flex items-center gap-1 text-xs text-sura-muted" title={t("chat.agentModeHint")}>
              <Switch checked={agentMode} onCheckedChange={(v) => setAgentMode(sessionId, v)} aria-label={t("chat.agentMode")} />
              {t("chat.agentMode")}
            </label>
          )}
          <ContextMeter used={props.sessionTokens} limit={props.contextLimit} assumed={props.contextAssumed} contextMode={props.contextMode} />
        </div>
      </div>

      {/* Advanced options — collapsed by default, hidden in simple mode */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex items-center gap-1 text-[length:var(--sura-text-caption)] text-[var(--sura-text-tertiary)] hover:text-[var(--sura-text-primary)] transition-colors"
          onClick={() => setAdvancedOpen(!advancedOpen)}
          aria-expanded={advancedOpen}
        >
          {advancedOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          {t("chat.advancedOptions")}
        </button>
        {/* يُعرض المفتاح دائمًا. مع هدف واحد كان لا يُرسم إطلاقًا، فكان من المستحيل إيقاف
            «سؤال موحد للجميع» والوصول إلى حقل السؤال المخصص لهذا النموذج. */}
        <span className="text-[length:var(--sura-text-caption)] text-[var(--sura-text-tertiary)]">·</span>
        <label className="flex items-center gap-1 text-[length:var(--sura-text-caption)] text-[var(--sura-text-tertiary)]" title={t("onboarding.syncDesc")}><Link2 className="size-3.5" /> {t("chat.syncMode")}
          <Switch checked={syncMode} onCheckedChange={(v) => setSyncMode(sessionId, v)} aria-label={t("chat.syncMode")} /></label>
      </div>

      {/* Advanced content — only visible when expanded */}
      {advancedOpen && (
        <div className="space-y-2 rounded-[var(--sura-radius-md)] border border-[var(--sura-border-primary)] bg-[var(--sura-surface-secondary)] p-2">
          {!syncMode && (focusTargetId
            ? targets.filter((target) => target.targetId === focusTargetId).map((target) => (
              <div key={target.targetId} className="space-y-1">
                <span className="text-[length:var(--sura-text-caption)] text-[var(--sura-text-tertiary)]">{t("chat.customField")} {PROVIDERS[target.providerId].label} · {target.modelId}</span>
                <Textarea value={customs[target.targetId] ?? ""} onChange={(e) => setCustom(sessionId, target.targetId, e.target.value)} placeholder={t("chat.customPlaceholder")} className="min-h-24" aria-label={t("chat.customField") + "" + PROVIDERS[target.providerId].label + "" + target.modelId} />
              </div>
            ))
            : targets.map((target) => (
              <button key={target.targetId} className="w-full text-start text-[length:var(--sura-text-caption)] px-2 py-1 rounded-[var(--sura-radius-sm)] border border-dashed border-[var(--sura-border-primary)] text-[var(--sura-text-tertiary)] hover:bg-[var(--sura-hover)]" onClick={() => setFocus(sessionId, target.targetId)}>
                {t("chat.customField")} {target.modelId} {(customs[target.targetId] ?? "").length > 0 ? "✓" : t("chat.customEmptyHint")}
              </button>
            ))
          )}
        </div>
      )}

      {/* The base Textarea already sets field-sizing-content, so this grows with the text;
          the max-height token is what keeps a long question from pushing the send row away. */}
      <Textarea ref={ref} value={sharedPrompt} onChange={(e) => setShared(sessionId, e.target.value)} onKeyDown={handleSharedKeyDown} placeholder={t("chat.sharedPlaceholder")} className="min-h-[var(--sura-composer-min-height)] max-h-[var(--sura-composer-max-height)] overflow-y-auto" aria-label={t("chat.sharedPlaceholder")} />

      <div className="flex items-center gap-2 justify-end">
        <span className="me-auto flex items-center gap-2 text-[length:var(--sura-text-caption)] text-[var(--sura-text-tertiary)]">
          <span className="hidden sm:inline">{t("chat.sendHint")}</span>
          {sharedPrompt.length > 0 && (
            <span
              title={t("chat.promptLength")}
              aria-label={t("chat.promptLengthOf", { count: formatNumber(sharedPrompt.length), max: formatNumber(LIMITS.sharedPromptMax) })}
            >
              {formatNumber(sharedPrompt.length)} / {formatNumber(LIMITS.sharedPromptMax)}
            </span>
          )}
        </span>
        <Button size="sm" variant="ghost" disabled={props.sending} onClick={props.onExtractSummary}><Sparkles className="size-4" /> {t("settings.extractSummary")}</Button>
        {props.sending
          ? <Button size="sm" variant="destructive" disabled={props.cancellable === false} onClick={props.onStop}><Square className="size-4" /> {t("chat.stop")}</Button>
          : <Button size="sm" onClick={props.onSend}><Send className="size-4" /> {t("chat.send")}</Button>}
      </div>

      <AddModelDialog open={dialogOpen} onOpenChange={setDialogOpen}
        onPick={(p: ProviderId, m: ModelInfo) => addTarget(sessionId, { providerId: p, modelId: m.id, modelInfo: m })} />
    </div>
  );
}
