import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { SummaryCard } from "./SummaryCard";
import type { ChatMessage } from "@/types";

const base: ChatMessage = {
  id: "s1", sessionId: "session", turnId: "turn", createdAt: 1,
  role: "assistant", kind: "synthesis", text: "خلاصة",
  providerId: "openrouter", modelId: "openai/gpt-4o", status: "done",
  usage: { inputTokens: 1, outputTokens: 2, cachedInputTokens: 0, costUSD: 0 },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SummaryCard", () => {
  it("يعرض النص الجزئي والخطأ والتحذير داخل live region", () => {
    render(<SummaryCard horizontal={false} msg={{ ...base, status: "error", text: "خلاصة جزئية", error: "تعذر الإكمال", sidecarWarning: "تعذر حفظ الأرشيف" }} />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-busy", "false");
    expect(screen.getByText("خلاصة جزئية")).toBeInTheDocument();
    expect(screen.getByText("تعذر الإكمال")).toBeInTheDocument();
    expect(screen.getByText("تعذر حفظ الأرشيف")).toBeInTheDocument();
  });

  it("يبلغ عن غياب clipboard بدل رمي استثناء", async () => {
    vi.stubGlobal("navigator", {});
    const errorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    render(<SummaryCard horizontal={false} msg={base} />);
    fireEvent.click(screen.getByLabelText("نسخ"));
    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith("تعذر نسخ النص"));
  });
});
