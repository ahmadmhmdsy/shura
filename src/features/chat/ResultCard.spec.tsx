import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { ResultCard } from "./ResultCard";
import { ResultCards } from "./ResultCards";
import type { ChatMessage } from "@/types";
import { uiText } from "@/i18n";
import { en } from "@/i18n/en";
import { INTERRUPTED_TURN_ERROR } from "@/lib/db/repos/attempts";
import { formatCost } from "@/lib/usage/cost";

const base: ChatMessage = { id: "m1", sessionId: "s", turnId: "t", createdAt: 1, role: "assistant", kind: "result", text: "جواب نهائي", providerId: "openrouter", modelId: "openai/gpt-4o", targetId: "t1", status: "done", usage: { inputTokens: 12, outputTokens: 30, cachedInputTokens: 4, costUSD: 0.0003 } };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ResultCard", () => {
  it("يعرض الاستخدام كاملًا وزر إعادة المحاولة", () => {
    render(<ResultCard msg={base} customPrompt={null} horizontal={false} onStop={() => {}} onRetry={() => {}} />);
    expect(screen.getByText("↓ 12")).toBeInTheDocument();
    expect(screen.getByText("↑ 30")).toBeInTheDocument();
    expect(screen.getByText("كاش 4")).toBeInTheDocument();
    expect(screen.getByText("$0.000300")).toBeInTheDocument();
    expect(screen.getByLabelText("إعادة")).toBeInTheDocument();
  });
  it("كتابة المخبأ تظهر فقط حين يبلّغ عنها المزود", () => {
    render(<ResultCard msg={{ ...base, usage: { ...base.usage!, cacheWriteInputTokens: 7 } }} customPrompt={null} horizontal={false} onStop={() => {}} onRetry={() => {}} />);
    expect(screen.getByText("كتابة كاش 7")).toBeInTheDocument();
  });

  it("لا تظهر كتابة المخبأ حين لا يبلّغ عنها المزود", () => {
    render(<ResultCard msg={base} customPrompt={null} horizontal={false} onStop={() => {}} onRetry={() => {}} />);
    expect(screen.queryByText(/كتابة كاش/)).not.toBeInTheDocument();
  });

  it("الحالة error تعرض رسالة الخطأ والحالة stopped تعرض أُوقف", () => {
    const { rerender } = render(
      <ResultCard msg={{ ...base, status: "error", error: "مفتاح غير صالح أو غير مصرح (401/403)" }} customPrompt={null} horizontal={false} onStop={() => {}} onRetry={() => {}} />,
    );
    expect(screen.getByText(/مفتاح غير صالح/)).toBeInTheDocument();
    rerender(<ResultCard msg={{ ...base, status: "stopped", text: "نص بعد الإيقاف" }} customPrompt={null} horizontal={false} onStop={() => {}} onRetry={() => {}} />);
    expect(screen.getByText("أُوقف")).toBeInTheDocument();
    expect(screen.getByText("نص بعد الإيقاف")).toBeInTheDocument();
    expect(screen.queryByText("مفتاح غير صالح أو غير مصرح (401/403)")).not.toBeInTheDocument();
  });
  it("السؤال المخصص قابل للطي", () => {
    render(<ResultCard msg={base} customPrompt="سؤال خاص" horizontal={false} onStop={() => {}} onRetry={() => {}} />);
    expect(screen.queryByText("سؤال خاص")).toBeNull();
    fireEvent.click(screen.getByText("السؤال المخصص"));
    expect(screen.getByText("سؤال خاص")).toBeInTheDocument();
  });

  it("يعرض النص الجزئي ورسالة الخطأ معا في حالة error", () => {
    render(<ResultCard msg={{ ...base, status: "error", text: "نص قبل الفشل", error: "انقطع البث" }} customPrompt={null} horizontal={false} onStop={() => {}} onRetry={() => {}} />);
    expect(screen.getByText("نص قبل الفشل")).toBeInTheDocument();
    expect(screen.getByText("انقطع البث")).toBeInTheDocument();
  });

  it("يعلن حالة البثLIVE혹은 content في region polite ويضبط aria-busy", () => {
    render(<ResultCard msg={{ ...base, status: "streaming", text: "يكتب الآن" }} customPrompt={null} horizontal={false} onStop={() => {}} onRetry={() => {}} />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("يكتب الآن")).toBeInTheDocument();
  });

  it("يعرض تحذير sidecar دون تغيير حالة النتيجة", () => {
    render(<ResultCard msg={{ ...base, sidecarWarning: "تعذر حفظ الأرشيف" }} customPrompt={null} horizontal={false} onStop={() => {}} onRetry={() => {}} />);
    expect(screen.getByText("تعذر حفظ الأرشيف")).toBeInTheDocument();
    expect(screen.getByLabelText("إعادة")).toBeInTheDocument();
  });

  it("الحالة truncated تعرض تنبيه الانقطاع وتحفظ النص الجزئي بلا خطأ (NM-02)", () => {
    render(<ResultCard msg={{ ...base, status: "truncated", text: "نص جزئي" }} customPrompt={null} horizontal={false} onStop={() => {}} onRetry={() => {}} />);
    expect(screen.getByText("غير مكتمل: انتهى البث مبكرًا")).toBeInTheDocument();
    expect(screen.getByText("نص جزئي")).toBeInTheDocument();
    // ليست حالة خطأ: لا role="alert" ولا رسالة خطأ
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("يبلغ عن رفض نسخ الحافظة بدل فقدان وعدها", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const errorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    render(<ResultCard msg={base} customPrompt={null} horizontal={false} onStop={() => {}} onRetry={() => {}} />);
    fireEvent.click(screen.getByLabelText("نسخ"));
    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith("تعذر نسخ النص"));
  });

  it("حالة التفكير: بطاقة البث تعرضها ثم تزول بأول نص (T2.7/LV-02)", () => {
    const { rerender } = render(
      <ResultCard msg={{ ...base, status: "streaming", text: "", reasoning: true }} customPrompt={null} horizontal={false} onStop={() => {}} onRetry={() => {}} />,
    );
    expect(screen.getByText("يفكّر…")).toBeInTheDocument();
    expect(screen.queryByText("يكتب…")).not.toBeInTheDocument();
    rerender(<ResultCard msg={{ ...base, status: "streaming", text: "بدأ الجواب" }} customPrompt={null} horizontal={false} onStop={() => {}} onRetry={() => {}} />);
    expect(screen.queryByText("يفكّر…")).not.toBeInTheDocument();
    expect(screen.getByText("يكتب…")).toBeInTheDocument();
  });
});

describe("ResultCards", () => {
  it("التخطيط يقود الصنف والتسمية: عمودي يعرض أفقي والعكس", () => {
    const { rerender } = render(
      <ResultCards msgs={[base]} layout="vertical" customPrompts={{}} onToggleLayout={() => {}} onStop={() => {}} onRetry={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /أفقي/ })).toBeInTheDocument();
    rerender(<ResultCards msgs={[base]} layout="horizontal" customPrompts={{}} onToggleLayout={() => {}} onStop={() => {}} onRetry={() => {}} />);
    expect(screen.getByRole("button", { name: /عمودي/ })).toBeInTheDocument();
  });
});
// [T3.1/D6] الخطأ المخزَّن يبقى بايتًا كما هو في الصف (عقد محفوظ) ويُترجَم عند العرض وحده:
// القيمة المعروفة تمرّ عبر `t`، والقيمة غير المعروفة تُعرض كما هي ولا تصير فارغة أبدًا.
describe("ResultCard persisted error text (T3.1/D6)", () => {
  beforeEach(() => uiText.setLocale("ar"));
  afterEach(() => uiText.setLocale("ar"));
  const interrupted = { ...base, status: "error" as const, error: INTERRUPTED_TURN_ERROR };

  it("القيمة المخزَّنة المعروفة تُعرض مترجَمة في الإنجليزية", () => {
    uiText.setLocale("en");
    render(<ResultCard msg={interrupted} customPrompt={null} horizontal={false} onStop={() => {}} onRetry={() => {}} />);
    expect(screen.getByText(en.errors.interruptedTurn)).toBeInTheDocument();
    expect(screen.queryByText(INTERRUPTED_TURN_ERROR)).not.toBeInTheDocument();
  });

  it("وفي العربية تُعرض القيمة المخزَّنة نفسها بلا تغيير مرئي", () => {
    uiText.setLocale("ar");
    render(<ResultCard msg={interrupted} customPrompt={null} horizontal={false} onStop={() => {}} onRetry={() => {}} />);
    expect(screen.getByText(INTERRUPTED_TURN_ERROR)).toBeInTheDocument();
  });

  it("وخطأ مخزَّن غير معروف يُعرض كما هو ولا يصير فارغًا", () => {
    uiText.setLocale("en");
    render(<ResultCard msg={{ ...base, status: "error", error: "فشل تخزين داخلي" }} customPrompt={null} horizontal={false} onStop={() => {}} onRetry={() => {}} />);
    expect(screen.getByText("فشل تخزين داخلي")).toBeInTheDocument();
  });
});

// [T3.4/LV-07] سلسلة التكلفة تأتي من مساعد واحد، والعلامة المجهولة من مفتاح مورد لا من
// محرف مكتوب في المكوّن:
describe("ResultCard cost string (T3.4/LV-07)", () => {
  beforeEach(() => uiText.setLocale("ar"));
  afterEach(() => uiText.setLocale("ar"));
  const render0 = (msg: ChatMessage) => render(<ResultCard msg={msg} customPrompt={null} horizontal={false} onStop={() => {}} onRetry={() => {}} />);

  it("سعر مجهول يعرض علامة المورد", () => {
    render0({ ...base, usage: { ...base.usage!, costUSD: null } });
    expect(screen.getByText(uiText.t("common.noValue"))).toBeInTheDocument();
  });

  it("وبلا استهلاك أصلًا تظهر العلامة نفسها", () => {
    render0({ ...base, usage: undefined });
    expect(screen.getByText(uiText.t("common.noValue"))).toBeInTheDocument();
  });

  it("والسعر المعروف يخرج من المساعد نفسه", () => {
    render0(base);
    expect(screen.getByText(formatCost(base.usage!.costUSD, uiText.t("common.noValue"), uiText.formatNumber))).toBeInTheDocument();
  });
});
