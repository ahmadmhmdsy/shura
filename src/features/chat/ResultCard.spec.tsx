import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { ResultCard } from "./ResultCard";
import { ResultCards } from "./ResultCards";
import type { ChatMessage } from "@/types";

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

  it("يبلغ عن رفض نسخ الحافظة بدل فقدان وعدها", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const errorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    render(<ResultCard msg={base} customPrompt={null} horizontal={false} onStop={() => {}} onRetry={() => {}} />);
    fireEvent.click(screen.getByLabelText("نسخ"));
    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith("تعذر نسخ النص"));
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
