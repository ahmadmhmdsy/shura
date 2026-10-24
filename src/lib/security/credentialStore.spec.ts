import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCredentialStore, type CredentialBackend, type StoredCredential } from "./credentialStore";
import type { ProviderId } from "@/types";

const memoryBackend = () => {
  const rows = new Map<string, StoredCredential>();
  return {
    rows,
    backend: {
      async read(id: ProviderId) { return rows.get(id) ?? null; },
      async write(id: ProviderId, row: StoredCredential) { rows.set(id, row); },
      async remove(id: ProviderId) { rows.delete(id); },
    } satisfies CredentialBackend,
  };
};

const utf8 = (value: string) => new TextEncoder().encode(value).buffer as ArrayBuffer;
const decode = (bytes: ArrayBuffer) => new TextDecoder().decode(new Uint8Array(bytes));

describe("web credential store", () => {
  let harness: ReturnType<typeof memoryBackend>;

  beforeEach(() => { harness = memoryBackend(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("round-trips a key through encrypted storage", async () => {
    const store = createCredentialStore(harness.backend);
    await store.set("openrouter", "sk-secret");
    expect(await store.get("openrouter")).toBe("sk-secret");
  });

  it("never stores plaintext", async () => {
    const store = createCredentialStore(harness.backend);
    await store.set("openrouter", "sk-secret");
    const row = harness.rows.get("openrouter")!;
    expect(JSON.stringify(row)).not.toContain("sk-secret");
    expect(decode(row.ciphertext)).not.toContain("sk-secret");
    expect(row.iv).toBeTruthy();
  });

  it("produces a different ciphertext each time for the same key", async () => {
    const store = createCredentialStore(harness.backend);
    await store.set("openrouter", "sk-same");
    const first = harness.rows.get("openrouter")!.ciphertext;
    await store.set("openrouter", "sk-same");
    const second = harness.rows.get("openrouter")!.ciphertext;
    expect(decode(first)).not.toBe(decode(second));
  });

  it("returns null for a provider that was never set", async () => {
    const store = createCredentialStore(harness.backend);
    expect(await store.get("google")).toBeNull();
  });

  it("clears a stored key", async () => {
    const store = createCredentialStore(harness.backend);
    await store.set("google", "g-key");
    await store.clear("google");
    expect(await store.get("google")).toBeNull();
    expect(harness.rows.has("google")).toBe(false);
  });

  it("refuses persistence when Web Crypto is unavailable", async () => {
    vi.stubGlobal("crypto", undefined);
    const store = createCredentialStore(harness.backend);
    await expect(store.set("openrouter", "sk-secret")).rejects.toThrow("errors.credentialCryptoUnavailable");
    expect(harness.rows.size).toBe(0);
  });

  it("refuses persistence when SubtleCrypto is unavailable", async () => {
    vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => bytes });
    const store = createCredentialStore(harness.backend);
    await expect(store.set("openrouter", "sk-secret")).rejects.toThrow("errors.credentialCryptoUnavailable");
    expect(harness.rows.size).toBe(0);
  });

  it("returns null instead of throwing when a stored row is corrupt", async () => {
    harness.rows.set("google", { iv: "AAAA", ciphertext: utf8("not-valid-ciphertext"), version: 1 });
    const store = createCredentialStore(harness.backend);
    await expect(store.get("google")).resolves.toBeNull();
  });

  it("rejects an empty key without touching storage", async () => {
    const store = createCredentialStore(harness.backend);
    await store.set("google", "   ");
    expect(await store.get("google")).toBeNull();
    expect(harness.rows.size).toBe(0);
  });
});