import { useState } from "react";
import { Plus, Link2, Send, Square, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useComposerStore } from "@/state/composerStore";
import { AddModelDialog } from "./AddModelDialog";
import { ContextMeter } from "./ContextMeter";
import { PROVIDERS } from "@/lib/providers/registry";
import { ar } from "@/i18n/ar";
import type { ModelInfo, ProviderId } from "@/types";

export interface ComposerProps {
  onSend(): void; onStop(): void; onExtractSummary(): void;
  sending: boolean; sessionTokens: number; contextLimit: number | null;
}

export function Composer(props: ComposerProps) {
  const { targets, syncMode, sharedPrompt, customs, focusTargetId, addTarget, removeTarget, setShared, setCustom, setSyncMode, setFocus } = useComposerStore();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="border-t border-sura-border bg-sura-panel p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {targets.map((t) => (
          <Badge key={t.targetId} variant={focusTargetId === t.targetId ? "default" : "secondary"} className="gap-1 cursor-pointer" onClick={() => setFocus(t.targetId)}>
            {PROVIDERS[t.providerId].label} · {t.modelId}
            <button aria-label="إزالة" onClick={(e) => { e.stopPropagation(); removeTarget(t.targetId); }}>×</button>
          </Badge>
        ))}
        <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}><Plus className="size-4" /> {ar.addModel}</Button>
        <label className="flex items-center gap-1 text-xs text-sura-muted"><Link2 className="size-3.5" /> {ar.syncMode}
          <Switch checked={syncMode} onCheckedChange={setSyncMode} /></label>
        <div className="flex-1" />
        <ContextMeter used={props.sessionTokens} limit={props.contextLimit ?? 128000} />
      </div>

      {!syncMode && (focusTargetId
        ? targets.filter((t) => t.targetId === focusTargetId).map((t) => (
            <div key={t.targetId} className="space-y-1">
              <span className="text-xs text-sura-muted">{ar.customField} {PROVIDERS[t.providerId].label} · {t.modelId}</span>
              <Textarea value={customs[t.targetId] ?? ""} onChange={(e) => setCustom(t.targetId, e.target.value)} placeholder="سؤال مخصص لهذا النموذج (فارغ = يرث السؤال الموحد)" className="min-h-24" />
            </div>
          ))
        : targets.map((t) => (
            <button key={t.targetId} className="w-full text-right text-xs px-2 py-1 rounded border border-dashed border-sura-border text-sura-muted hover:bg-sura-border/30" onClick={() => setFocus(t.targetId)}>
              {ar.customField} {t.modelId} {(customs[t.targetId] ?? "").length > 0 ? "✓" : "(فارغ = يرث الموحد)"}
            </button>
          ))
      )}

      <Textarea value={sharedPrompt} onChange={(e) => setShared(e.target.value)} placeholder={ar.sharedPlaceholder} className="min-h-20" />

      <div className="flex items-center gap-2 justify-end">
        <Button size="sm" variant="ghost" onClick={props.onExtractSummary}><Sparkles className="size-4" /> {ar.extractSummary}</Button>
        {props.sending
          ? <Button size="sm" variant="destructive" onClick={props.onStop}><Square className="size-4" /> {ar.stop}</Button>
          : <Button size="sm" onClick={props.onSend}><Send className="size-4" /> {ar.send}</Button>}
      </div>

      <AddModelDialog open={dialogOpen} onOpenChange={setDialogOpen}
        onPick={(p: ProviderId, m: ModelInfo) => addTarget({ providerId: p, modelId: m.id })} />
    </div>
  );
}
