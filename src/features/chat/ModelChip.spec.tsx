import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ModelChip } from "./ModelChip";

describe("ModelChip", () => {
  it("يعرض اسم المزود ومعرّف النموذج", () => {
    render(<ModelChip providerId="openrouter" modelId="openai/gpt-4o" onRemove={() => {}} />);
    expect(screen.getByText("OpenRouter · openai/gpt-4o")).toBeInTheDocument();
  });

  it("النقر على البطاقة يستدعي onClick", () => {
    const onClick = vi.fn();
    render(<ModelChip providerId="google" modelId="gemini-2.5-pro" onRemove={() => {}} onClick={onClick} />);
    fireEvent.click(screen.getByText("Google Gemini · gemini-2.5-pro"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("زر الإزالة يستدعي onRemove ولا يستدعي onClick", () => {
    const onRemove = vi.fn();
    const onClick = vi.fn();
    render(<ModelChip providerId="minimax" modelId="MiniMax-M2" onRemove={onRemove} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "إزالة" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("بدون onClick لا ينكسر النقر على البطاقة", () => {
    render(<ModelChip providerId="opencodego" modelId="glm-5.3" onRemove={() => {}} />);
    fireEvent.click(screen.getByText("OpenCode Go · glm-5.3"));
    expect(screen.getByText("OpenCode Go · glm-5.3")).toBeInTheDocument();
  });

  it("focused يغيّر شكل البطاقة إلى الافتراضي", () => {
    const { container } = render(<ModelChip providerId="openrouter" modelId="openai/gpt-4o" onRemove={() => {}} focused />);
    expect(container.querySelector('[data-slot="badge"]')?.getAttribute("data-variant")).toBe("default");
  });

  it("غير المركّز يظهر بالشكل الثانوي", () => {
    const { container } = render(<ModelChip providerId="openrouter" modelId="openai/gpt-4o" onRemove={() => {}} />);
    expect(container.querySelector('[data-slot="badge"]')?.getAttribute("data-variant")).toBe("secondary");
  });
});
