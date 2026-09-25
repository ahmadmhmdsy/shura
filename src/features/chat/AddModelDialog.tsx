/* eslint-disable react-hooks/set-state-in-effect -- the static list must paint before the live request resolves */
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PROVIDERS, getProvider, listProviderIds } from "@/lib/providers/registry";
import { fetchModelCatalog } from "@/lib/providers/modelCatalog";
import type { ModelInfo, ProviderId } from "@/types";
import { ar } from "@/i18n/ar";

export function AddModelDialog({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (v: boolean) => void; onPick: (p: ProviderId, m: ModelInfo) => void }) {
  const [provider, setProvider] = useState<ProviderId | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Each provider selection owns one controller and one generation, so a slow response
  // from a provider the user already left can never overwrite the current list.
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!provider) { setModels([]); return; }
    const p = getProvider(provider);
    const mine = ++generation.current;
    controller.current?.abort();
    setModels(p.staticModels); setError(null);
    if (p.modelsSource !== "live" || !p.liveModelsUrl) { setLoading(false); return; }

    const local = new AbortController();
    controller.current = local;
    setLoading(true);
    fetchModelCatalog(provider, { signal: local.signal })
      .then((list) => {
        if (generation.current !== mine || local.signal.aborted) return;
        if (list.length) setModels(list);
      })
      .catch((e: unknown) => {
        if (generation.current !== mine || local.signal.aborted) return;
        setError("تعذر جلب قائمة الموديلات — تُعرض القائمة الاحتياطية (" + String((e as { message?: string })?.message ?? e) + ")");
      })
      .finally(() => {
        if (generation.current === mine) setLoading(false);
      });
    return () => { local.abort(); };
  }, [provider]);

  // Closing the dialog must not leave a request running against a component the user
  // already dismissed.
  useEffect(() => {
    if (open) return;
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
  }, [open]);

  const close = (v: boolean) => {
    if (!v) { generation.current += 1; controller.current?.abort(); controller.current = null; setProvider(null); }
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{provider ? ar.model : ar.provider}</DialogTitle>
          {provider ? <Button variant="ghost" size="sm" className="self-start" onClick={() => setProvider(null)}>رجوع</Button> : null}
        </DialogHeader>
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
              <Button key={m.id} variant="ghost" className="justify-between font-normal" onClick={() => { onPick(provider, m); close(false); }}>
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
