import { create } from "zustand";
import type { ProviderId } from "@/types";
import { getSetting, setSetting } from "@/lib/db/repos";

export interface PersistedSettings {
  providerKeys: Partial<Record<ProviderId, string>>;
  primaryTarget: { providerId: ProviderId; modelId: string } | null;
  sessionRootDir: string | null;
  timeoutMs: number;
}

interface SettingsState extends PersistedSettings {
  loaded: boolean;
  load(): Promise<void>;
  setProviderKey(id: ProviderId, key: string): Promise<void>;
  setPrimaryTarget(t: PersistedSettings["primaryTarget"]): Promise<void>;
  setSessionRootDir(p: string | null): Promise<void>;
  setTimeoutMs(ms: number): Promise<void>;
}

const KEY = "settings.main";
const defaults: PersistedSettings = { providerKeys: {}, primaryTarget: null, sessionRootDir: null, timeoutMs: 120_000 };

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...defaults, loaded: false,
  async load() {
    const saved = (await getSetting<PersistedSettings>(KEY)) ?? {};
    set({ ...defaults, ...saved, loaded: true });
  },
  async setProviderKey(id, key) {
    const next = { ...get().providerKeys, [id]: key };
    set({ providerKeys: next });
    await setSetting(KEY, { ...get(), providerKeys: next, loaded: undefined } as unknown as PersistedSettings);
  },
  async setPrimaryTarget(t) { set({ primaryTarget: t }); await persistAll(get, set); },
  async setSessionRootDir(p) { set({ sessionRootDir: p }); await persistAll(get, set); },
  async setTimeoutMs(ms) { set({ timeoutMs: ms }); await persistAll(get, set); },
}));

async function persistAll(get: () => SettingsState, set: (s: Partial<SettingsState>) => void): Promise<void> {
  const { loaded: _l, load: _ld, ...data } = get();
  void _l; void _ld;
  await setSetting(KEY, data);
  void set;
}
