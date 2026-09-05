import { describe, expect, it } from "vitest";
import { useSettingsStore } from "./settingsStore";
import { db } from "@/lib/db/db";

describe("settingsStore", () => {
  it("تخزين مفتاح مزود يكتب لقطة بيانات صرفة بلا دوال", async () => {
    await useSettingsStore.getState().setProviderKey("openrouter", "sk-1");
    const row = await db.settings.get("settings.main");
    const v = row?.value as Record<string, unknown> | undefined;
    expect(v).toBeDefined();
    expect(() => structuredClone(v)).not.toThrow();
    expect(Object.values(v!).every((x) => typeof x !== "function")).toBe(true);
  });
});
