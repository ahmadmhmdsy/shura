import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "./settingsStore";
import { getSetting, setSetting } from "@/lib/db/repos";
import { initializeCredentialStore, setCredentialStoreForTest } from "@/lib/security/credentialBackend";
import type { CredentialStore } from "@/lib/security/credentialStore";
import type { ProviderId } from "@/types";

vi.mock("@/lib/db/repos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/repos")>();
  return { ...actual, setSetting: vi.fn(async () => undefined), getSetting: vi.fn(async () => null) };
});

const memoryCredentials = () => {
  const values = new Map<string, string>();
  const store: CredentialStore = {
    async get(id) { return values.get(id) ?? null; },
    async set(id, value) { values.set(id, value); },
    async clear(id) { values.delete(id); },
  };
  return { values, store };
};

let harness: ReturnType<typeof memoryCredentials>;
const realStore = useSettingsStore.getState();

beforeEach(() => {
  harness = memoryCredentials();
  setCredentialStoreForTest(harness.store);
  vi.mocked(setSetting).mockReset().mockImplementation(async () => undefined);
  vi.mocked(getSetting).mockReset().mockImplementation(async () => null as never);
  useSettingsStore.setState({
    ...realStore,
    providerKeys: {},
    primaryTarget: null,
    sessionRootDir: null,
    timeoutMs: 120_000,
    loaded: false,
    saving: false,
    error: null,
  });
});

describe("settingsStore", () => {
  it("تخزين مفتاح مزود يكتب لقطة بيانات صرفة بلا دوال", async () => {
    await useSettingsStore.getState().setProviderKey("openrouter", "sk-1");
    const snapshot = vi.mocked(setSetting).mock.calls.at(-1)?.[1] as Record<string, unknown> | undefined;
    expect(snapshot).toBeDefined();
    expect(() => structuredClone(snapshot)).not.toThrow();
    expect(Object.values(snapshot!).every((value) => typeof value !== "function")).toBe(true);
  });

  it("does not serialize a provider key into settings.main", async () => {
    await useSettingsStore.getState().setProviderKey("openrouter", "secret-value");
    expect(JSON.stringify(vi.mocked(setSetting).mock.calls)).not.toContain("secret-value");
  });

  it("keeps the key in memory and in the credential store only", async () => {
    await useSettingsStore.getState().setProviderKey("openrouter", "secret-value");
    expect(harness.values.get("openrouter")).toBe("secret-value");
    expect(useSettingsStore.getState().providerKeys.openrouter).toBe("secret-value");
    expect(vi.mocked(setSetting).mock.calls.at(-1)?.[1]).not.toHaveProperty("providerKeys");
  });

  it("clearing removes the credential and the in-memory key", async () => {
    await useSettingsStore.getState().setProviderKey("openrouter", "secret-value");
    await useSettingsStore.getState().setProviderKey("openrouter", "");
    expect(harness.values.has("openrouter")).toBe(false);
    expect(useSettingsStore.getState().providerKeys.openrouter).toBeUndefined();
  });

  it("migrates a legacy plaintext key out of the settings record", async () => {
    vi.mocked(getSetting).mockImplementation(async () => ({ providerKeys: { openrouter: "legacy-secret" } }) as never);
    await useSettingsStore.getState().load();

    expect(harness.values.get("openrouter")).toBe("legacy-secret");
    expect(JSON.stringify(vi.mocked(setSetting).mock.calls)).not.toContain("legacy-secret");
    expect(useSettingsStore.getState().providerKeys.openrouter).toBe("legacy-secret");
  });

  it("does not keep a plaintext copy when migration fails", async () => {
    vi.mocked(getSetting).mockImplementation(async () => ({ providerKeys: { openrouter: "legacy-secret" } }) as never);
    setCredentialStoreForTest({
      async get() { return null; },
      async set() { throw new Error("تعذر الوصول إلى مخزن المفاتيح"); },
      async clear() { throw new Error("تعذر الوصول إلى مخزن المفاتيح"); },
    });

    await useSettingsStore.getState().load();

    expect(useSettingsStore.getState().providerKeys.openrouter).toBeUndefined();
    expect(useSettingsStore.getState().error).toMatch(/أعد إدخال|تعذّر|تعذر/);
    expect(useSettingsStore.getState().error).not.toContain("legacy-secret");
    expect(JSON.stringify(vi.mocked(setSetting).mock.calls)).not.toContain("legacy-secret");
  });

  it("loads keys from the credential store when the settings record has none", async () => {
    await (await initializeCredentialStore()).set("minimax", "stored-key");
    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState().providerKeys.minimax).toBe("stored-key");
  });

  it("rolls back a failed settings write and exposes a bounded error", async () => {
    const before = useSettingsStore.getState().timeoutMs;
    vi.mocked(setSetting).mockRejectedValueOnce(new Error("C:\\Users\\name\\private\\settings"));

    await expect(useSettingsStore.getState().setTimeoutMs(33_000)).rejects.toThrow();

    expect(useSettingsStore.getState().timeoutMs).toBe(before);
    expect(useSettingsStore.getState().error).not.toContain("Users");
  });

  it("keeps the in-memory value when the credential write fails", async () => {
    const before = useSettingsStore.getState().providerKeys.openrouter;
    setCredentialStoreForTest({
      async get() { return null; },
      async set() { throw new Error("فشل خانق C:\\Users\\x"); },
      async clear() { throw new Error("فشل خانق"); },
    });

    await expect(useSettingsStore.getState().setProviderKey("openrouter", "new-secret")).rejects.toThrow();

    expect(useSettingsStore.getState().providerKeys.openrouter).toBe(before);
    expect(useSettingsStore.getState().error).not.toContain("Users");
  });

  it("serializes concurrent writes so the last write wins", async () => {
    const order: string[] = [];
    let first = true;
    vi.mocked(setSetting).mockImplementation(async (_key, value) => {
      const label = String((value as { timeoutMs: number }).timeoutMs);
      order.push("start:" + label);
      if (first) { first = false; await new Promise((resolve) => setTimeout(resolve, 10)); }
      order.push("end:" + label);
    });

    await Promise.all([
      useSettingsStore.getState().setTimeoutMs(20_000),
      useSettingsStore.getState().setTimeoutMs(40_000),
    ]);

    // Serialized, not interleaved: every start is immediately followed by its own end.
    expect(order.filter((entry) => entry.startsWith("start:")).length).toBe(2);
    expect(order.every((entry, index) => entry.startsWith(index % 2 === 0 ? "start" : "end"))).toBe(true);
    expect(order).toEqual(["start:40000", "end:40000", "start:40000", "end:40000"]);
    expect(useSettingsStore.getState().timeoutMs).toBe(40_000);
  });

  it("clamps the timeout to the allowed range", async () => {
    await useSettingsStore.getState().setTimeoutMs(99_999_999);
    expect(useSettingsStore.getState().timeoutMs).toBe(300_000);
    await useSettingsStore.getState().setTimeoutMs(1);
    expect(useSettingsStore.getState().timeoutMs).toBe(10_000);
  });

  it("never persists an unknown provider id", async () => {
    await expect(useSettingsStore.getState().setProviderKey("evil" as ProviderId, "x")).rejects.toThrow();
  });

  it("defaults agentMode to always", () => {
    expect(useSettingsStore.getState().ragSettings.agentMode).toBe("always");
  });

  it("persists agentMode through setRagSettings", async () => {
    await useSettingsStore.getState().setRagSettings({ agentMode: "toggle" });
    expect(useSettingsStore.getState().ragSettings.agentMode).toBe("toggle");
    const snapshot = vi.mocked(setSetting).mock.calls.at(-1)?.[1] as { rag?: { agentMode?: string } } | undefined;
    expect(snapshot?.rag?.agentMode).toBe("toggle");
  });
});