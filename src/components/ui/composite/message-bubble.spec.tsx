import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageBubble } from "./message-bubble";

describe("فقاعة الرسالة", () => {
  it("تعرض رسالة المستخدم مع أيقونة المستخدم", () => {
    render(<MessageBubble role="user" content="مرحبا بك" />);
    expect(screen.getByText("مرحبا بك")).toBeTruthy();
  });

  it("تعرض رسالة المساعد كنص منسق", () => {
    render(<MessageBubble role="assistant" content="# عنوان رئيسي" />);
    expect(screen.getByRole("heading", { name: "عنوان رئيسي" })).toBeTruthy();
  });

  it("تعرض رسالة النظام في المنتصف", () => {
    render(<MessageBubble role="system" content="رسالة نظام" />);
    expect(screen.getByText("رسالة نظام")).toBeTruthy();
  });

  it("تعرض الخطأ بدلًا من المحتوى عند تمرير error", () => {
    render(<MessageBubble role="assistant" content="محتوى" error="حدث خطأ" />);
    expect(screen.getByText("حدث خطأ")).toBeTruthy();
    expect(screen.queryByText("محتوى")).toBeNull();
  });

  it("تعرض مؤشر البث أثناء الكتابة", () => {
    render(<MessageBubble role="assistant" content="نص" isStreaming />);
    expect(screen.getByText("نص")).toBeTruthy();
  });

  it("يعرض اسم النموذج عند تمرير modelLabel", () => {
    render(<MessageBubble role="assistant" content="نص" modelLabel="GPT-4" />);
    expect(screen.getByText("GPT-4")).toBeTruthy();
  });
});
