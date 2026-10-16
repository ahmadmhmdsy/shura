/* eslint-disable react-hooks/set-state-in-effect -- the static list must paint before the live request resolves */
import { useEffect, useRef, useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PROVIDERS, getProvider, listProviderIds } from "@/lib/providers/registry";
import { fetchModelCatalog } from "@/lib/providers/modelCatalog";
import type { ModelInfo, ProviderId } from "@/types";
import { useSettingsStore } from "@/state/settingsStore";
import { useUiText } from "@/i18n";
import { errorText } from "@/lib/errors/keyedError";

const RECENT_MODELS_KEY = "shura-recent-models";
const MAX_RECENT_MODELS = 5;

function getRecentModels(): ModelInfo[] {
  try {
    const stored = localStorage.getItem(RECENT_MODELS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

function addRecentModel(model: ModelInfo): void {
  try {
    const recent = getRecentModels().filter((m) => m.id !== model.id);
    recent.unshift(model);
    localStorage.setItem(RECENT_MODELS_KEY, JSON.stringify(recent.slice(0, MAX_RECENT_MODELS)));
  } catch { /* storage unavailable */ }
}

export function AddModelDialog({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (v: boolean) => void; onPick: (p: ProviderId, m: ModelInfo) => void }) {
  const { t } = useUiText();
  const providerKeys = useSettingsStore((s) => s.providerKeys);
  const [provider, setProvider] = useState<ProviderId | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  
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
    const apiKey = providerKeys[provider] ?? "";
    // [T2.8/LV-04] بلا مفتاح تبقى القائمة الساكنة (وكل معرّفاتها مستحقة) بدل جلب القائمة
    // المجهولة التي تحمل نماذج لا يملك المستخدم حقّها.
    if (p.catalogNeedsKey && !apiKey.trim()) { setLoading(false); return; }

    const local = new AbortController();
    controller.current = local;
    setLoading(true);
    fetchModelCatalog(provider, { signal: local.signal, apiKey })
      .then((list) => {
        if (generation.current !== mine || local.signal.aborted) return;
        if (list.length) setModels(list);
      })
      .catch((e: unknown) => {
        if (generation.current !== mine || local.signal.aborted) return;
        setError(t("chat.modelsFetchFailed", { detail: errorText(t, e) }));
      })
      .finally(() => {
        if (generation.current === mine) setLoading(false);
      });
    return () => { local.abort(); };
  }, [provider, t, providerKeys]);

  // Closing the dialog must not leave a request running against a component the user
  // already dismissed.
  useEffect(() => {
    if (open) return;
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
  }, [open]);

  const close = (v: boolean) => {
    if (!v) { generation.current += 1; controller.current?.abort(); controller.current = null; setProvider(null); setSearchQuery("");  }
    onOpenChange(v);
  };

  const filteredModels = useMemo(() => {
    if (!searchQuery.trim()) return models;
    const q = searchQuery.toLowerCase();
    return models.filter((m) => m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
  }, [models, searchQuery]);

  const recentModels = useMemo(() => {
    if (searchQuery.trim()) return [];
    return getRecentModels().filter((m) => models.some((model) => model.id === m.id)).slice(0, MAX_RECENT_MODELS);
  }, [models, searchQuery]);

  const handlePick = (p: ProviderId, m: ModelInfo) => {
    addRecentModel(m);
    onPick(p, m);
    close(false);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{provider ? t("chat.model") : t("chat.provider")}</DialogTitle>
          {provider ? <Button variant="ghost" size="sm" className="self-start" onClick={() => { setProvider(null);  }}>{t("common.back")}</Button> : null}
        </DialogHeader>
        {!provider ? (
          <div className="space-y-3">
            <div className="grid gap-2">
              {listProviderIds()
                
                .map((id) => (
                  <Button key={id} variant="outline" className="justify-between" onClick={() => setProvider(id)}>
                    <span>{PROVIDERS[id].label}</span>
                    {!PROVIDERS[id].browserDirect && <span className="text-xs text-sura-warn">{t("settings.desktopRequired")}</span>}
                  </Button>
                ))}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("chat.searchModels")}
              aria-label={t("chat.searchModels")}
              className="h-8 text-sm"
            />
            <div className="max-h-80 overflow-y-auto grid gap-1">
              {loading && <p className="text-xs text-sura-muted">{t("chat.loadingModels")}</p>}
              {error && <p className="text-xs text-sura-warn">{error}</p>}
              {recentModels.length > 0 && (
                <>
                  <p className="text-xs text-sura-muted font-medium pt-1">{t("chat.recentModels")}</p>
                  {recentModels.map((m) => (
                    <Button key={m.id} variant="ghost" className="justify-between font-normal" onClick={() => handlePick(provider, m)}>
                      <span className="truncate">{m.label}</span>
                      <span className="text-[10px] text-sura-muted">{m.id}</span>
                    </Button>
                  ))}
                </>
              )}
              {filteredModels.map((m) => (
                <Button key={m.id} variant="ghost" className="justify-between font-normal" onClick={() => handlePick(provider, m)}>
                  <span className="truncate">{m.label}</span>
                  <span className="text-[10px] text-sura-muted">{m.id}</span>
                </Button>
              ))}
              {filteredModels.length === 0 && !loading && (
                <p className="text-xs text-sura-muted text-center py-4">{t("chat.noResults")}</p>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}