import { create } from "zustand";
import { DEFAULT_RAG_SETTINGS, type ProviderId, type RagSettings } from "@/types";
import { getSetting, setSetting } from "@/lib/db/repos";
import { initializeCredentialStore } from "@/lib/security/credentialBackend";
import { redactExternalError } from "@/lib/security/redact";
import { LIMITS, clampTimeoutMs } from "@/lib/limits";
import { listProviderIds } from "@/lib/providers/registry";
import { logger } from "@/lib/logging";

/** The persisted record never contains a credential: keys live in the credential store. */
export interface PersistedSettings {
  primaryTarget: { providerId: ProviderId; modelId: string } | null;
  sessionRootDir: string | null;
  timeoutMs: number;
  rag: RagSettings;
  simpleMode: boolean;
}

/** Shape written by older builds, read once so plaintext keys can be migrated out. */
interface LegacySettings extends PersistedSettings {
  providerKeys?: Partial<Record<ProviderId, string>>;
}

interface SettingsState extends PersistedSettings {
  /** In-memory only. Never persisted, never rendered as clear text. */
  providerKeys: Partial<Record<ProviderId, string>>;
  loaded: boolean;
  saving: boolean;
  error: string | null;
  ragSettings: RagSettings;
  load(): Promise<void>;
  setProviderKey(id: ProviderId, key: string): Promise<void>;
  setPrimaryTarget(t: PersistedSettings["primaryTarget"]): Promise<void>;
  setSessionRootDir(p: string | null): Promise<void>;
  setTimeoutMs(ms: number): Promise<void>;
  setRagSettings(patch: Partial<RagSettings>): Promise<void>;
  setSimpleMode(enabled: boolean): Promise<void>;
}

const KEY = "settings.main";
const defaults: PersistedSettings = { primaryTarget: null, sessionRootDir: null, timeoutMs: 120_000, rag: DEFAULT_RAG_SETTINGS, simpleMode: false };

/** Pinned to these values while simple mode hides the RAG sections. */
const SIMPLE_MODE_RAG_DEFAULTS: Partial<RagSettings> = {
  defaultSearchMode: "hybrid",
  searchResultCount: 5,
};

let writeQueue: Promise<void> = Promise.resolve();

function isProviderId(id: string): id is ProviderId {
  return (listProviderIds() as string[]).includes(id);
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  // Every write is serialized: two overlapping settings writes could otherwise persist
  // an older snapshot last and silently undo the newer one.
  const enqueue = (write: () => Promise<void>): Promise<void> => {
    const run = writeQueue.then(write, write);
    writeQueue = run.catch(() => undefined);
    return run;
  };

  return {
    ...defaults,
    providerKeys: {},
    loaded: false,
    saving: false,
    error: null,
    ragSettings: defaults.rag,

    async load() {
      logger.info("Loading settings");
      const saved = ((await getSetting<LegacySettings>(KEY)) ?? {}) as LegacySettings;
      const legacyKeys = saved.providerKeys ?? {};
      const keys: Partial<Record<ProviderId, string>> = {};
      const failures: string[] = [];

      for (const providerId of listProviderIds()) {
        const legacy = legacyKeys[providerId];
        try {
          const store = await initializeCredentialStore();
          if (typeof legacy === "string" && legacy) {
            // A legacy plaintext key is moved into the credential store and the
            // settings record is rewritten without it. If that fails the key is
            // dropped rather than kept in plaintext, and the user is told to re-enter it.
            await store.set(providerId, legacy);
            keys[providerId] = legacy;
          } else {
            const stored = await store.get(providerId);
            if (stored) keys[providerId] = stored;
          }
        } catch (error) {
          failures.push(redactExternalError(error));
        }
      }

      const hasLegacy = Object.values(legacyKeys).some((value) => typeof value === "string" && value);
      set({
        ...defaults,
        ...saved,
        providerKeys: keys,
        ragSettings: saved.rag ?? DEFAULT_RAG_SETTINGS,
        loaded: true,
        error: failures.length ? "تعذّر نقل بعض مفاتيح المزودين — أعد إدخالها: " + failures[0] : null,
      });
      if (hasLegacy) await enqueue(() => persist(get));
    },

    async setProviderKey(id, key) {
      if (!isProviderId(id)) throw new Error("مزود غير معروف");
      const trimmed = key.trim();
      if (trimmed.length > LIMITS.apiKeyMax) throw new Error("مفتاح المزود يتجاوز الحد المسموح");
      const before = get().providerKeys[id];
      set({ saving: true, error: null });
      try {
        await enqueue(async () => {
          const store = await initializeCredentialStore();
          if (trimmed) await store.set(id, trimmed);
          else await store.clear(id);
          const providerKeys = { ...get().providerKeys };
          if (trimmed) providerKeys[id] = trimmed;
          else delete providerKeys[id];
          set({ providerKeys });
          await persist(get);
        });
      } catch (error) {
        // Roll back the in-memory value: a half-applied key would be shown as saved
        // while the store still holds the old one.
        const providerKeys = { ...get().providerKeys };
        if (before) providerKeys[id] = before;
        else delete providerKeys[id];
        set({ providerKeys, error: redactExternalError(error) });
        throw new Error(redactExternalError(error), { cause: error });
      } finally {
        set({ saving: false });
      }
    },

    async setPrimaryTarget(t) { await applyChange(set, get, enqueue, { primaryTarget: t }); },
    async setSessionRootDir(p) { await applyChange(set, get, enqueue, { sessionRootDir: p }); },
    async setTimeoutMs(ms) { await applyChange(set, get, enqueue, { timeoutMs: clampTimeoutMs(ms) }); },
    async setRagSettings(patch) { await applyChange(set, get, enqueue, { rag: { ...get().ragSettings, ...patch } }); },
    async setSimpleMode(enabled: boolean) {
      // Simple mode hides the RAG sections, so enabling it pins their settings to
      // the recommended defaults; disabling only restores their visibility.
      const patch: Partial<PersistedSettings> = enabled
        ? { simpleMode: true, rag: { ...get().ragSettings, ...SIMPLE_MODE_RAG_DEFAULTS } }
        : { simpleMode: false };
      await applyChange(set, get, enqueue, patch);
    },
  };
});

type SetState = (partial: Partial<SettingsState>) => void;
type GetState = () => SettingsState;
type Enqueue = (write: () => Promise<void>) => Promise<void>;

async function applyChange(set: SetState, get: GetState, enqueue: Enqueue, patch: Partial<PersistedSettings>): Promise<void> {
  logger.info("Applying settings change", { keys: Object.keys(patch) });
  const before = { ...get() };
  const ragBefore = get().ragSettings;
  set({ ...patch, ragSettings: patch.rag ?? ragBefore, saving: true, error: null });
  try {
    await enqueue(() => persist(get));
  } catch (error) {
    const message = redactExternalError(error);
    set({
      primaryTarget: before.primaryTarget,
      sessionRootDir: before.sessionRootDir,
      timeoutMs: before.timeoutMs,
      ragSettings: ragBefore,
      simpleMode: before.simpleMode,
      error: message,
    });
    throw new Error(message, { cause: error });
  } finally {
    set({ saving: false });
  }
}

async function persist(get: GetState): Promise<void> {
  const state = get();
  const snapshot: PersistedSettings = {
    primaryTarget: state.primaryTarget,
    sessionRootDir: state.sessionRootDir,
    timeoutMs: state.timeoutMs,
    rag: state.ragSettings,
    simpleMode: state.simpleMode,
  };
  await setSetting(KEY, snapshot);
}