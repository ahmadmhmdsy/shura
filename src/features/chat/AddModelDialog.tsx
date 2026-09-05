/* eslint-disable react-hooks/set-state-in-effect -- كود الخطة الحرفية: إعادة مزامنة قائمة الموديلات داخل التأثير عند تغيير المزود؛ القاعدة إرشادية (cascading renders) والحيود يُفتح نادرًا */
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PROVIDERS, getProvider, listProviderIds } from "@/lib/providers/registry";
import type { ModelInfo, ProviderId } from "@/types";
import { ar } from "@/i18n/ar";

export function AddModelDialog({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (v: boolean) => void; onPick: (p: ProviderId, m: ModelInfo) => void }) {
  const [provider, setProvider] = useState<ProviderId | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!provider) { setModels([]); return; }
    const p = getProvider(provider);
    setModels(p.staticModels); setError(null);
    if (p.modelsSource === "live" && p.liveModelsUrl) {
      setLoading(true);
      fetch(p.liveModelsUrl)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((j: { data?: { id: string; name?: string; context_length?: number; pricing?: { prompt?: string; completion?: string } }[] }) => {
          const list = (j.data ?? []).map((m) => ({
            id: m.id, label: m.name ?? m.id, contextLength: m.context_length,
            pricing: m.pricing?.prompt != null && m.pricing?.completion != null
              ? { inputPerMTok: Number(m.pricing.prompt) * 1e6, outputPerMTok: Number(m.pricing.completion) * 1e6 } : null,
          })).filter((m) => m.id);
          if (list.length) setModels(list);
        })
        .catch((e) => setError("تعذر جلب قائمة الموديلات — تُعرض القائمة الاحتياطية (" + String(e?.message ?? e) + ")"))
        .finally(() => setLoading(false));
    }
  }, [provider]);

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setProvider(null); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{provider ? ar.model : ar.provider}</DialogTitle></DialogHeader>
        {!provider ? (
          <div className="grid gap-2">
            {listProviderIds().map((id) => (
              <Button key={id} variant="outline" className="justify-between" onClick={() => setProvider(id)}>
                <span>{PROVIDERS[id].label}</span>
                {!PROVIDERS[id].browserDirect && <span className="text-xs text-sura-warn">{ar.desktopRequired}</span>}
              </Button>
            ))}
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto grid gap-1">
            {loading && <p className="text-xs text-sura-muted">جلب الموديلات…</p>}
            {error && <p className="text-xs text-sura-warn">{error}</p>}
            {models.map((m) => (
              <Button key={m.id} variant="ghost" className="justify-between font-normal" onClick={() => { onPick(provider, m); onOpenChange(false); setProvider(null); }}>
                <span className="truncate">{m.label}</span>
                <span className="text-[10px] text-sura-muted">{m.id}</span>
              </Button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
