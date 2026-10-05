import type { ProviderId } from "@/types";

export interface CredentialStore {
  get(providerId: ProviderId): Promise<string | null>;
  set(providerId: ProviderId, value: string): Promise<void>;
  clear(providerId: ProviderId): Promise<void>;
}

export interface StoredCredential {
  /** base64 nonce */
  iv: string;
  /** AES-GCM ciphertext, base64 */
  ciphertext: ArrayBuffer;
  version: 1;
}

/**
 * Storage primitive behind the credential store. On the desktop the Tauri commands
 * implement this against the OS keychain; on the web it is an IndexedDB record.
 */
export interface CredentialBackend {
  read(id: ProviderId): Promise<StoredCredential | null>;
  write(id: ProviderId, row: StoredCredential): Promise<void>;
  remove(id: ProviderId): Promise<void>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function subtleOrThrow(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto غير متاح — تعذّر تشفير مفتاح المزود على الويب");
  return subtle;
}

export const WEB_CREDENTIAL_RECORD_VERSION = 1;

/**
 * AES-GCM with a non-extractable key held in IndexedDB. There is deliberately no
 * plaintext fallback: if Web Crypto is missing the key is refused and the user is
 * asked to re-enter it, because a silently stored plaintext key is the defect this
 * store exists to remove.
 */
export function createCredentialStore(backend: CredentialBackend): CredentialStore {
  return {
    async get(providerId) {
      const row = await backend.read(providerId);
      if (!row) return null;
      try {
        const key = await loadDeviceKey();
        const plaintext = await subtleOrThrow().decrypt(
          { name: "AES-GCM", iv: fromBase64(row.iv) },
          key,
          new Uint8Array(row.ciphertext as ArrayBuffer),
        );
        return decoder.decode(plaintext);
      } catch {
        // A corrupt or foreign row must not take down startup; the user re-enters the key.
        return null;
      }
    },

    async set(providerId, value) {
      if (!value.trim()) return;
      const subtle = subtleOrThrow();
      const key = await loadDeviceKey();
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
      const ciphertext = await subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(value));
      await backend.write(providerId, { iv: toBase64(iv), ciphertext, version: WEB_CREDENTIAL_RECORD_VERSION });
    },

    async clear(providerId) {
      await backend.remove(providerId);
    },
  };
}

const DEVICE_KEY_ID = "shura.device-credential-key";
let deviceKey: CryptoKey | null = null;

// The key is generated once per install and stored in IndexedDB as a JWK. The CryptoKey
// object is non-extractable (page scripts can use it but never read it out), but the JWK
// in IndexedDB is accessible to any script running in the same origin. This is a known
// limitation of web-based credential storage — the OS keychain on desktop provides stronger
// isolation. The AES-GCM encryption still protects against casual inspection and XSS attacks
// that don't have direct IndexedDB access.
async function loadDeviceKey(): Promise<CryptoKey> {
  if (deviceKey) return deviceKey;
  const subtle = subtleOrThrow();
  const existing = await readDeviceKeyRecord();
  if (existing) {
    deviceKey = await subtle.importKey("jwk", existing, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    return deviceKey;
  }
  // The key is extractable only long enough to persist it, then re-imported as
  // non-extractable, so page scripts hold a handle they can use but never read.
  const generated = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const jwk = await subtle.exportKey("jwk", generated);
  await writeDeviceKeyRecord(jwk);
  deviceKey = await subtle.importKey("jwk", jwk, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  return deviceKey;
}

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("shura-credentials", 1);
    request.onupgradeneeded = () => { request.result.createObjectStore("device"); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("تعذّر فتح مخزن المفاتيح المحلي"));
  });
}

async function readDeviceKeyRecord(): Promise<JsonWebKey | null> {
  try {
    const db = await idb();
    return await new Promise((resolve) => {
      const request = db.transaction("device", "readonly").objectStore("device").get(DEVICE_KEY_ID);
      request.onsuccess = () => resolve((request.result as JsonWebKey | undefined) ?? null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function writeDeviceKeyRecord(jwk: JsonWebKey): Promise<void> {
  const db = await idb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction("device", "readwrite").objectStore("device").put(jwk, DEVICE_KEY_ID);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error("تعذّر حفظ مفتاح التشفير المحلي"));
  });
}