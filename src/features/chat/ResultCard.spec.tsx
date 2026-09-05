import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResultCard } from "./ResultCard";
import { ResultCards } from "./ResultCards";
import type { ChatMessage } from "@/types";

const base: ChatMessage = { id: "m1", sessionId: "s", turnId: "t", createdAt: 1, role: "assistant", kind: "result", text: "جواب نهائي", providerId: "openrouter", modelId: "openai/gpt-4o", targetId: "t1", status: "done", usage: { inputTokens: 12, outputTokens: 30, cachedInputTokens: 4, costUSD: 0.0003 } };

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
    rerender(<ResultCard msg={{ ...base, status: "stopped" }} customPrompt={null} horizontal={false} onStop={() => {}} onRetry={() => {}} />);
    expect(screen.getByText("أُوقف")).toBeInTheDocument();
  });
  it("السؤال المخصص قابل للطي", () => {
    render(<ResultCard msg={base} customPrompt="سؤال خاص" horizontal={false} onStop={() => {}} onRetry={() => {}} />);
    expect(screen.queryByText("سؤال خاص")).toBeNull();
    fireEvent.click(screen.getByText("السؤال المخصص"));
    expect(screen.getByText("سؤال خاص")).toBeInTheDocument();
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
