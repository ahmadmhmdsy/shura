import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { Composer } from "./Composer";
import { useComposerStore, EMPTY_COMPOSER_DRAFT } from "@/state/composerStore";
import { useSettingsStore } from "@/state/settingsStore";
import { DEFAULT_RAG_SETTINGS } from "@/types";

// التنبيهات لا تُرسم في jsdom دون <Toaster />، فنستبدلها بنداء مفحوص حتى يتسنى التحقق
// من نص التنبيه نفسه ومن زر التراجع الذي يرفقه المكوّن.
vi.mock("sonner", () => ({ toast: vi.fn() }));

function renderComposer(over: { sending?: boolean } = {}) {
  return render(<Composer sessionId="s1" onSend={() => {}} onStop={() => {}} onExtractSummary={() => {}} sending={over.sending ?? false} sessionTokens={0} contextLimit={null} contextMode="stateful" onContextModeChange={() => {}} />);
}

describe("Composer agent mode switch", () => {
  beforeEach(() => {
    useComposerStore.setState({ drafts: {} });
  });

  it("يظهر مفتاح وضع الوكيل عندما يكون الإعداد toggle", () => {
    useSettingsStore.setState({ ragSettings: { ...DEFAULT_RAG_SETTINGS, agentMode: "toggle" } });
    renderComposer();
    expect(screen.getByLabelText("وضع الوكيل")).toBeTruthy();
  });

  it("يخفي مفتاح وضع الوكيل عندما يكون الإعداد always", () => {
    useSettingsStore.setState({ ragSettings: { ...DEFAULT_RAG_SETTINGS, agentMode: "always" } });
    renderComposer();
    expect(screen.queryByLabelText("وضع الوكيل")).toBeNull();
  });
});

describe("Composer — إمكانيات الإرسال", () => {
  const SHARED = "اكتب سؤالك الموحد للجميع…";

  beforeEach(() => {
    useComposerStore.setState({ drafts: {} });
  });

  it("يعرض تلميح الإرسال، وعدّاد الطول لا يظهر إلا مع وجود نص", () => {
    renderComposer();
    expect(screen.getByText("Ctrl+Enter للإرسال · Shift+Enter لسطر جديد")).toBeTruthy();
    expect(screen.queryByTitle("طول السؤال")).toBeNull();
    fireEvent.change(screen.getByLabelText(SHARED), { target: { value: "مرحبا" } });
    expect(screen.getByTitle("طول السؤال").textContent).toBe("5 / 100,000");
  });

  it("يمسح المسودة عند Escape ويعرض تراجعًا", () => {
    useComposerStore.setState({ drafts: { s1: { ...EMPTY_COMPOSER_DRAFT, sharedPrompt: "نص" } } });
    renderComposer();
    fireEvent.keyDown(screen.getByLabelText(SHARED), { key: "Escape" });
    expect(useComposerStore.getState().drafts.s1.sharedPrompt).toBe("");
    expect(toast).toHaveBeenCalledWith(
      "تم مسح المسودة",
      expect.objectContaining({ action: expect.objectContaining({ label: "تراجع" }) }),
    );
  });

  it("لا يمسح المسودة عند Escape أثناء الإرسال", () => {
    useComposerStore.setState({ drafts: { s1: { ...EMPTY_COMPOSER_DRAFT, sharedPrompt: "نص" } } });
    renderComposer({ sending: true });
    fireEvent.keyDown(screen.getByLabelText(SHARED), { key: "Escape" });
    expect(useComposerStore.getState().drafts.s1.sharedPrompt).toBe("نص");
  });

  it("لا يفعل شيئًا عند Escape والمسودة فارغة", () => {
    renderComposer();
    fireEvent.keyDown(screen.getByLabelText(SHARED), { key: "Escape" });
    expect(screen.queryByText("تم مسح المسودة")).toBeNull();
  });

  it("يحدّ نمو الحقل بارتفاع أقصى من رموز الأبعاد", () => {
    renderComposer();
    expect(screen.getByLabelText(SHARED).className).toContain("max-h-[var(--sura-composer-max-height)]");
  });
});
