import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSettingsStore } from "@/state/settingsStore";
import { testProviderKey } from "@/lib/providers/keyTest";
import { getProvider } from "@/lib/providers/registry";
import { LIMITS, limitError } from "@/lib/limits";
import { ar } from "@/i18n/ar";
import type { ProviderId } from "@/types";

export function ProviderKeyCard({ id }: { id: ProviderId }) {
  const p = getProvider(id);
  const saved = useSettingsStore((s) => s.providerKeys[id] ?? "");
  const setKey = useSettingsStore((s) => s.setProviderKey);
  const [draft, setDraft] = useState(saved);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const [limitErrorText, setLimitErrorText] = useState<string | null>(null);

  // An external update (migration, clear) must reach the field without overwriting a
  // draft the user is still typing. Adjusting during render is React's own pattern for
  // "state changed from outside" and avoids a visible one-frame stale value.
  const [lastSaved, setLastSaved] = useState(saved);
  if (lastSaved !== saved) {
    setLastSaved(saved);
    setDraft(saved);
  }

  // The field holds a local draft: every keystroke used to write a credential store,
  // which is both slow and a chance to persist half a key.
  const commit = () => {
    if (draft === saved) return;
    if (draft.length > LIMITS.apiKeyMax) {
      setLimitErrorText(limitError("مفتاح المزود", LIMITS.apiKeyMax));
      return;
    }
    setLimitErrorText(null);
    void setKey(id, draft);
  };

  return (
    <div className="border border-sura-border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{p.label}</span>
        {!p.browserDirect && <span className="text-[10px] text-sura-warn">{ar.desktopRequired}</span>}
      </div>
      <label className="block text-xs text-sura-muted" htmlFor={`provider-key-${id}`}>مفتاح API</label>
      <Input id={`provider-key-${id}`} type="password" autoComplete="off" spellCheck={false} maxLength={LIMITS.apiKeyMax}
        value={draft} placeholder={ar.apiKey}
        onChange={(e) => { setDraft(e.target.value); setLimitErrorText(null); }}
        onBlur={commit} />
      {limitErrorText && <p role="alert" className="text-xs text-sura-danger">{limitErrorText}</p>}
      <div className="flex items-center gap-2">
        {/* The test must use the saved key, never an unsaved draft. */}
        <Button size="sm" variant="outline" disabled={testing || !saved.trim()}
          onClick={() => { setTesting(true); testProviderKey(id, saved, p.staticModels[0].id).then((r) => { setOk(r.ok); setResult(r.detail); }).finally(() => setTesting(false)); }}>
          {ar.testKey}
        </Button>
        <Button size="sm" variant="ghost" disabled={!saved} onClick={() => { setDraft(""); setLimitErrorText(null); void setKey(id, ""); }}>
          مسح
        </Button>
        {result && <span className={"text-xs " + (ok ? "text-sura-accent" : "text-sura-danger")}>{result}</span>}
      </div>
    </div>
  );
}
