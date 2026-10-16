import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsScreen } from "./SettingsScreen";
import { useSettingsStore } from "@/state/settingsStore";
import { useComposerStore } from "@/state/composerStore";
import App from "@/App";

function resetStores(): void {
  useSettingsStore.setState({ providerKeys: {}, primaryTarget: null, sessionRootDir: null, timeoutMs: 120_000, loaded: false });
  useComposerStore.setState({ drafts: {} });
}

beforeEach(resetStores);

describe("SettingsScreen", () => {
  it("يعرض أربع بطاقات مزودين", () => {
    render(<SettingsScreen onClose={() => {}} />);
    // كل تسمية تظهر مرتين على الأقل: بطاقة المزود + خيار قائمة «النموذج الأساسي» — نكفي بوجودها
    for (const label of ["OpenRouter", "Google Gemini", "MiniMax", "OpenCode Go"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("تعيين النموذج الأساسي يحدث المخزن ويعرض «الحالي»", async () => {
    render(<SettingsScreen onClose={() => {}} />);
    const modelSel = screen.getByRole("combobox", { name: "نموذج الموديل الأساسي" });
    fireEvent.change(modelSel, { target: { value: "openai/gpt-4o" } });
    const assign = screen.getByRole("button", { name: "تعيين" });
    await waitFor(() => expect(assign).toBeEnabled());
    fireEvent.click(assign);
    await waitFor(() => expect(useSettingsStore.getState().primaryTarget).toEqual({ providerId: "openrouter", modelId: "openai/gpt-4o" }));
    expect(screen.getByText(/الحالي: openrouter · openai\/gpt-4o/)).toBeInTheDocument();
  });

  it("زر تعيين معطّل قبل اختيار نموذج، ومع أهداف فارغة يظهر تحذير «لم تضف نماذج بعد»", () => {
    render(<SettingsScreen onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "تعيين" })).toBeDisabled();
    expect(screen.getByText(/لم تضف نماذج بعد/)).toBeInTheDocument();
  });

  it("مع وجود أهداف في المُرسِل لا يظهر تحذير «لم تضف نماذج بعد»", () => {
    useComposerStore.getState().setDraft("seed", { targets: [{ targetId: "t1", providerId: "openrouter", modelId: "openai/gpt-4o", modelInfo: { id: "openai/gpt-4o", label: "GPT-4o" } }] });
    render(<SettingsScreen onClose={() => {}} />);
    expect(screen.queryByText(/لم تضف نماذج بعد/)).not.toBeInTheDocument();
  });

  it("مسار الحفظ: الافتراضي بلا قيمة محفوظة، والقيمة المحفوظة عند وجودها", () => {
    const { unmount } = render(<SettingsScreen onClose={() => {}} />);
    expect(screen.getByDisplayValue("Documents/Shura (يعمل داخل تطبيق سطح المكتب)")).toBeInTheDocument();
    unmount();
    useSettingsStore.setState({ sessionRootDir: "D:/جلسات شورى" });
    render(<SettingsScreen onClose={() => {}} />);
    expect(screen.getByDisplayValue("D:/جلسات شورى")).toBeInTheDocument();
  });

  it("المهلة تعرض الثواني والإلزام عند blur يكتب مللي (30 ⇒ 30000)", async () => {
    render(<SettingsScreen onClose={() => {}} />);
    const input = screen.getByDisplayValue("120");
    fireEvent.change(input, { target: { value: "30" } });
    fireEvent.blur(input);
    await waitFor(() => expect(useSettingsStore.getState().timeoutMs).toBe(30_000));
  });

  it("المهلة: كتابة «120» رقمًا رقمًا تبقى مسودة بلا كتابة مخزن لكل ضربة، والإلزام عند blur (انحدار: لا 1020)", async () => {
    render(<SettingsScreen onClose={() => {}} />);
    const input = screen.getByDisplayValue("120");
    fireEvent.change(input, { target: { value: "1" } });
    // كتابة المخزن لكل ضربة هي الخلل الموثق: «1» ⇒ تثبيت 10ث ثم «102» ⇒ 102ث ثم 1020ث تُحفظ صامتة
    expect(useSettingsStore.getState().timeoutMs).toBe(120_000);
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.change(input, { target: { value: "120" } });
    fireEvent.blur(input);
    await waitFor(() => expect(useSettingsStore.getState().timeoutMs).toBe(120_000));
    expect(screen.getByDisplayValue("120")).toBeInTheDocument();
  });

  it("زر «تم» يعيد التحميل ثم يغلق الشاشة", async () => {
    let closed = 0;
    render(<SettingsScreen onClose={() => { closed += 1; }} />);
    fireEvent.click(screen.getByRole("button", { name: "تم" }));
    await waitFor(() => expect(useSettingsStore.getState().loaded).toBe(true));
    expect(closed).toBe(1);
  });

  it("النقر داخل اللوحة لا يغلق", () => {
    let closed = 0;
    render(<SettingsScreen onClose={() => { closed += 1; }} />);
    fireEvent.click(screen.getByRole("dialog"));
    expect(closed).toBe(0);
    // الإغلاق بالخلفية: Radix يعتمد على قياسات التخطيط غير المتوفرة في jsdom،
    // لذلك يُختبر الإغلاق بلوحة المفاتيح في accessibility.spec.tsx بدل ادّعاء تغطية غير موجودة.
  });
  it("تغيير المزود يصفّر اختيار النموذج فلا تُحفظ زوجة مزود/موديل غير صالحة", async () => {
    render(<SettingsScreen onClose={() => {}} />);
    const modelSel = screen.getByRole("combobox", { name: "نموذج الموديل الأساسي" });
    fireEvent.change(modelSel, { target: { value: "openai/gpt-4o" } });

    fireEvent.change(screen.getByRole("combobox", { name: "مزود النموذج الأساسي" }), { target: { value: "google" } });

    await waitFor(() => expect((modelSel as HTMLSelectElement).value).toBe(""));
    expect(screen.getByRole("button", { name: "تعيين" })).toBeDisabled();
    expect(useSettingsStore.getState().primaryTarget).toBeNull();
  });

  it("الزوجة المحفوظة غير الصالحة تُعرض كتحذير صريح", () => {
    useSettingsStore.setState({ primaryTarget: { providerId: "google", modelId: "openai/gpt-4o" } });
    render(<SettingsScreen onClose={() => {}} />);
    expect(screen.getByText(/غير صالح|لا ينتمي/)).toBeInTheDocument();
  });

  it("الزوجة المحفوظة الصالحة لا تُعرض كتحذير", () => {
    useSettingsStore.setState({ primaryTarget: { providerId: "openrouter", modelId: "openai/gpt-4o" } });
    render(<SettingsScreen onClose={() => {}} />);
    expect(screen.queryByText(/غير صالح|لا ينتمي/)).not.toBeInTheDocument();
  });

});

describe("App — ربط شاشة الإعدادات", () => {
  it("فتح الإعدادات من السايدبار يعرض الشاشة الحقيقية بدل العنصر النائب", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "الإعدادات" }));
    expect(await screen.findByRole("heading", { name: "الإعدادات" })).toBeInTheDocument();
    expect(screen.getAllByText("OpenRouter").length).toBeGreaterThan(0);
    expect(screen.queryByText(/المهمة 12/)).not.toBeInTheDocument();
  });
});