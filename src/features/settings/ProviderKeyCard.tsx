import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSettingsStore } from "@/state/settingsStore";
import { testProviderKey } from "@/lib/providers/keyTest";
import { getProvider } from "@/lib/providers/registry";
import { ar } from "@/i18n/ar";
import type { ProviderId } from "@/types";

export function ProviderKeyCard({ id }: { id: ProviderId }) {
  const p = getProvider(id);
  const key = useSettingsStore((s) => s.providerKeys[id] ?? "");
  const setKey = useSettingsStore((s) => s.setProviderKey);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);

  return (
    <div className="border border-sura-border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{p.label}</span>
        {!p.browserDirect && <span className="text-[10px] text-sura-warn">{ar.desktopRequired}</span>}
      </div>
      <Input type="password" value={key} placeholder={ar.apiKey} onChange={(e) => void setKey(id, e.target.value)} />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={testing || !key.trim()}
          onClick={() => { setTesting(true); testProviderKey(id, key, p.staticModels[0].id).then((r) => { setOk(r.ok); setResult(r.detail); }).finally(() => setTesting(false)); }}>
          {ar.testKey}
        </Button>
        {result && <span className={"text-xs " + (ok ? "text-sura-accent" : "text-sura-danger")}>{result}</span>}
      </div>
    </div>
  );
}
