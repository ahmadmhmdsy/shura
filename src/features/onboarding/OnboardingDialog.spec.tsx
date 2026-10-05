import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { hasSeenOnboarding, markOnboardingSeen, OnboardingDialog } from "./OnboardingDialog";

// زر التخطي وزر إغلاق الحوار كلاهما يحمل الاسم «تخطي» (closeLabel)، لذا يُفرّق بينهما عبر data-slot
function getSkipButton(): HTMLElement {
  const matches = screen.getAllByRole("button", { name: "تخطي" });
  const skip = matches.find((el) => el.getAttribute("data-slot") === "button");
  if (!skip) throw new Error("تعذّر العثور على زر التخطي");
  return skip;
}

function getCloseButton(): HTMLElement {
  const matches = screen.getAllByRole("button", { name: "تخطي" });
  const close = matches.find((el) => el.getAttribute("data-slot") === "dialog-close");
  if (!close) throw new Error("تعذّر العثور على زر إغلاق الحوار");
  return close;
}

describe("OnboardingDialog — علامات المشاهدة", () => {
  it("hasSeenOnboarding تعيد false قبل الحفظ وtrue بعده", () => {
    localStorage.removeItem("shura-onboarding-seen");
    expect(hasSeenOnboarding()).toBe(false);
    markOnboardingSeen();
    expect(hasSeenOnboarding()).toBe(true);
    expect(localStorage.getItem("shura-onboarding-seen")).toBe("true");
  });
});

describe("OnboardingDialog — المعالج", () => {
  it("يعرض الخطوة الأولى مع «التالي» ويخفي «السابق» و«ابدأ»", () => {
    render(<OnboardingDialog open onClose={() => {}} />);
    expect(screen.getByText("ما هي شورى؟")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "التالي" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "السابق" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ابدأ" })).not.toBeInTheDocument();
  });

  it("التالي ينتقل للخطوة الثانية ويُظهر «السابق»", () => {
    render(<OnboardingDialog open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    expect(screen.getByText("إضافة النماذج")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "السابق" })).toBeInTheDocument();
  });

  it("السابق يعود للخطوة الأولى", () => {
    render(<OnboardingDialog open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    fireEvent.click(screen.getByRole("button", { name: "السابق" }));
    expect(screen.getByText("ما هي شورى؟")).toBeInTheDocument();
  });

  it("مؤشرات الخطوات تنتقل مباشرة للخطوة المختارة", () => {
    render(<OnboardingDialog open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "الخطوة 3" }));
    expect(screen.getByText("إرسال ومقارنة")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ابدأ" })).toBeInTheDocument();
  });

  it("مؤشر الخطوة الحالية معلَّم بـ aria-current", () => {
    render(<OnboardingDialog open onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "الخطوة 1" })).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByRole("button", { name: "الخطوة 2" }));
    expect(screen.getByRole("button", { name: "الخطوة 2" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "الخطوة 1" })).not.toHaveAttribute("aria-current");
  });

  it("تخطي يغلق الحوار دون إعادة تعيين الخطوة", () => {
    const onClose = vi.fn();
    const { rerender } = render(<OnboardingDialog open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    fireEvent.click(getSkipButton());
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<OnboardingDialog open={false} onClose={onClose} />);
    rerender(<OnboardingDialog open onClose={onClose} />);
    expect(screen.getByText("إضافة النماذج")).toBeInTheDocument();
  });

  it("جرّب مثالًا يغلق الحوار دون إعادة تعيين الخطوة", () => {
    const onClose = vi.fn();
    const { rerender } = render(<OnboardingDialog open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    fireEvent.click(screen.getByRole("button", { name: "جرّب مثالًا" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<OnboardingDialog open={false} onClose={onClose} />);
    rerender(<OnboardingDialog open onClose={onClose} />);
    expect(screen.getByText("إضافة النماذج")).toBeInTheDocument();
  });

  it("ابدأ في الخطوة الأخيرة يغلق الحوار ويعيد الخطوة الأولى", () => {
    const onClose = vi.fn();
    const { rerender } = render(<OnboardingDialog open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    expect(screen.getByText("إرسال ومقارنة")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ابدأ" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<OnboardingDialog open={false} onClose={onClose} />);
    rerender(<OnboardingDialog open onClose={onClose} />);
    expect(screen.getByText("ما هي شورى؟")).toBeInTheDocument();
  });

  it("زر إغلاق الحوار يعيد الخطوة الأولى", () => {
    const onClose = vi.fn();
    const { rerender } = render(<OnboardingDialog open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    expect(screen.getByText("إضافة النماذج")).toBeInTheDocument();
    fireEvent.click(getCloseButton());
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<OnboardingDialog open={false} onClose={onClose} />);
    rerender(<OnboardingDialog open onClose={onClose} />);
    expect(screen.getByText("ما هي شورى؟")).toBeInTheDocument();
  });
});
