import { beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useShallow } from "zustand/react/shallow";
import { EMPTY_COMPOSER_DRAFT, useComposerStore } from "./composerStore";
import type { TargetConfig } from "@/types";

// المرجع: .superpowers/sdd/hardening-task-3-brief.md الخطوة 3 — عقد المخزن الموقّع بمعرف الجلسة.
// كل أكشن مطلوب أن يحمل معرف الجلسة صراحةً وأن مسودات الجلسات معزولة بعضها عن بعض.
const modelInfo = { id: "openai/gpt-4o", label: "GPT-4o" };
const targetFull: TargetConfig = { targetId: "t1", providerId: "openrouter", modelId: "openai/gpt-4o", modelInfo };
const targetNoId: Omit<TargetConfig, "targetId"> = { providerId: "openrouter", modelId: "openai/gpt-4o", modelInfo };

beforeEach(() => {
  // عزل بين الاختبارات: مسودات الجلسات فقط — لم يبقَ سطح موروث بعد الخطوة 5
  useComposerStore.setState({ drafts: {} });
});

describe("composerStore — مسودة موقّعة بمعرف الجلسة", () => {
  it("مسودة A لا تظهر في B", () => {
    useComposerStore.getState().setDraft("session-a", { sharedPrompt: "سؤال A", targets: [targetFull] });
    const b = useComposerStore.getState().getDraft("session-b");
    expect(b.sharedPrompt).toBe("");
    expect(b.targets).toEqual([]);
  });

  it("getDraft لجلسة مجهولة يعيد مسودة فارغة جديدة ولا يكتب في المخزن", () => {
    useComposerStore.getState().setDraft("s1", { sharedPrompt: "سؤال" });
    const first = useComposerStore.getState().getDraft("unknown");
    expect(first).toEqual({ targets: [], syncMode: true, sharedPrompt: "", customs: {}, focusTargetId: null, agentMode: false });
    // كائن جديد في كل نداء (لا نسخ من مسودة أخرى ولا مرجع مشترك)
    expect(useComposerStore.getState().getDraft("unknown")).not.toBe(first);
    expect(useComposerStore.getState().drafts["unknown"]).toBeUndefined();
  });

  it("محدد المسودة المجهولة يبقى ثابتًا بين reread المتجر", () => {
    const { result, rerender } = renderHook(() => useComposerStore(useShallow((state) => {
      const draft = state.drafts["unknown-ui"] ?? EMPTY_COMPOSER_DRAFT;
      return {
        targets: draft.targets,
        syncMode: draft.syncMode,
        sharedPrompt: draft.sharedPrompt,
        customs: draft.customs,
        focusTargetId: draft.focusTargetId,
      };
    })));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("setDraft يبني مسودة كاملة على القاعدة الفارغة", () => {
    useComposerStore.getState().setDraft("s1", { sharedPrompt: "سؤال" });
    expect(useComposerStore.getState().getDraft("s1")).toEqual({ targets: [], syncMode: true, sharedPrompt: "سؤال", customs: {}, focusTargetId: null, agentMode: false });
  });

  it("setDraft يدمج على مسودة قائمة بدل تفريغها", () => {
    useComposerStore.getState().setDraft("s1", { sharedPrompt: "سؤال", targets: [targetFull] });
    useComposerStore.getState().setDraft("s1", { focusTargetId: "t1" });
    const d = useComposerStore.getState().getDraft("s1");
    expect(d.sharedPrompt).toBe("سؤال");
    expect(d.targets).toEqual([targetFull]);
    expect(d.focusTargetId).toBe("t1");
  });

  it("addTarget يولّد targetId ويعزل الهدف داخل جلسته مع modelInfo", () => {
    const s = useComposerStore.getState();
    s.addTarget("s1", targetNoId);
    s.addTarget("s1", { providerId: "minimax", modelId: "MiniMax-M2", modelInfo: { id: "MiniMax-M2", label: "MiniMax M2" } });
    const d = s.getDraft("s1");
    expect(d.targets).toHaveLength(2);
    for (const t of d.targets) expect(t.targetId.startsWith("tgt_")).toBe(true);
    expect(d.targets.map((t) => t.targetId)).toEqual([...new Set(d.targets.map((t) => t.targetId))]);
    // لا تسرب إلى جلسة أخرى، وبقية حقول مسودة الجلسة الأم تظل بديهياتها
    expect(s.getDraft("s2").targets).toEqual([]);
    expect(d.syncMode).toBe(true);
    expect(d.customs).toEqual({});
    expect(d.targets[0]?.modelInfo).toEqual(modelInfo);
  });

  it("setShared/setCustom/setSyncMode/setFocus جميعها مقيدة بجلستها", () => {
    const s = useComposerStore.getState();
    s.setShared("s1", "سؤال A");
    s.setShared("s2", "سؤال B");
    expect(s.getDraft("s1").sharedPrompt).toBe("سؤال A");
    expect(s.getDraft("s2").sharedPrompt).toBe("سؤال B");
    s.setCustom("s1", "t1", "خاص A");
    expect(s.getDraft("s1").customs["t1"]).toBe("خاص A");
    expect(s.getDraft("s2").customs["t1"]).toBeUndefined();
    s.setSyncMode("s1", false);
    expect(s.getDraft("s1").syncMode).toBe(false);
    expect(s.getDraft("s2").syncMode).toBe(true);
    s.setFocus("s1", "t1");
    expect(s.getDraft("s1").focusTargetId).toBe("t1");
    expect(s.getDraft("s2").focusTargetId).toBeNull();
  });

  it("setAgentMode مقيد بجلسته ويبقى افتراضيًا false", () => {
    const s = useComposerStore.getState();
    expect(s.getDraft("s1").agentMode).toBe(false);
    s.setAgentMode("s1", true);
    expect(s.getDraft("s1").agentMode).toBe(true);
    expect(s.getDraft("s2").agentMode).toBe(false);
  });

  it("removeTarget ينظف الحقل المخصص والتركيز داخل جلسته فقط", () => {
    const s = useComposerStore.getState();
    s.setDraft("s1", { targets: [targetFull], focusTargetId: "t1" });
    s.setCustom("s1", "t1", "خاص");
    s.removeTarget("s1", "t1");
    const d = s.getDraft("s1");
    expect(d.targets).toEqual([]);
    expect(d.customs["t1"]).toBeUndefined();
    expect(d.focusTargetId).toBeNull();
  });

  it("clearSession يحذف مسودة الجلسة وتعود فارغة جديدة", () => {
    const s = useComposerStore.getState();
    s.setDraft("s1", { sharedPrompt: "سؤال" });
    s.clearSession("s1");
    expect(s.drafts["s1"]).toBeUndefined();
    expect(s.getDraft("s1").sharedPrompt).toBe("");
  });
});
