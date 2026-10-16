import { isTauri } from "@/lib/transport/transport";
import type { CredentialBackend, CredentialStore } from "./credentialStore";

type Invoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;

/**
 * Desktop store: the plaintext value goes straight to the OS keychain through the
 * Tauri commands and never touches IndexedDB or the settings record.
 */
export function createKeychainCredentialStore(invoke: Invoke): CredentialStore {
  return {
    async get(providerId) {
      const value = await invoke("get_provider_key", { providerId });
      return typeof value === "string" && value ? value : null;
    },
    async set(providerId, value) {
      if (!value.trim()) return;
      await invoke("set_provider_key", { providerId, value });
    },
    async clear(providerId) {
      await invoke("delete_provider_key", { providerId });
    },
  };
}

async function webCredentialStore(): Promise<CredentialStore> {
  const [{ createCredentialStore: create }, { db }] = await Promise.all([
    import("./credentialStore"),
    import("@/lib/db/db"),
  ]);
  const backend: CredentialBackend = {
    async read(providerId) {
      const row = await db.credentials.get(providerId);
      return row ? { iv: row.iv, ciphertext: row.ciphertext, version: 1 } : null;
    },
    async write(providerId, row) {
      await db.credentials.put({ providerId, iv: row.iv, ciphertext: row.ciphertext });
    },
    async remove(providerId) {
      await db.credentials.delete(providerId);
    },
  };
  return create(backend);
}

let store: CredentialStore | null = null;
let storePromise: Promise<CredentialStore> | null = null;
let override: CredentialStore | null = null;

async function buildCredentialStore(): Promise<CredentialStore> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return createKeychainCredentialStore(invoke as Invoke);
  }
  return webCredentialStore();
}

/** The process-wide credential store, built once for the current platform. */
export async function initializeCredentialStore(): Promise<CredentialStore> {
  if (override) return override;
  if (store) return store;
  // Cache the in-flight promise, not just the resolved store: concurrent callers (the
  // settings panel and a startup migration) must not build the store twice.
  if (!storePromise) {
    storePromise = buildCredentialStore().catch((error) => {
      storePromise = null;
      throw error;
    });
  }
  store = await storePromise;
  return store;
}

export function getCredentialStore(): CredentialStore {
  if (override) return override;
  if (store) return store;
  throw new Error("لم يُهيَّأ مخزن المفاتيح بعد");
}

export function setCredentialStoreForTest(next: CredentialStore | null): void {
  override = next;
}
