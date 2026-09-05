import { beforeEach, describe, expect, it } from "vitest";
import { useComposerStore } from "./composerStore";

const target = { targetId: "t1", providerId: "openrouter" as const, modelId: "openai/gpt-4o" };

beforeEach(() => { useComposerStore.getState().reset(); });

describe("composerStore", () => {
  it("إضافة هدف ثم إزالته ينظف حقل المخصص", () => {
    const s = useComposerStore.getState();
    s.addTarget(target);
    s.setCustom("t1", "خاص");
    expect(useComposerStore.getState().customs["t1"]).toBe("خاص");
    useComposerStore.getState().removeTarget("t1");
    expect(useComposerStore.getState().customs["t1"]).toBeUndefined();
  });
  it("تبديل الوضع الموحد يخفي الحقول منطقيًا", () => {
    useComposerStore.getState().setSyncMode(false);
    expect(useComposerStore.getState().syncMode).toBe(false);
    useComposerStore.getState().setSyncMode(true);
    expect(useComposerStore.getState().syncMode).toBe(true);
  });
  it("وضع التركيز: تعيين وإلغاء", () => {
    useComposerStore.getState().addTarget(target);
    useComposerStore.getState().setFocus("t1");
    expect(useComposerStore.getState().focusTargetId).toBe("t1");
    useComposerStore.getState().setFocus(null);
    expect(useComposerStore.getState().focusTargetId).toBeNull();
  });
});
