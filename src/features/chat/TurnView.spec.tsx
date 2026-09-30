import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TurnView } from "./TurnView";
import type { ChatMessage } from "@/types";

const result: ChatMessage = {
  id: "r1", sessionId: "s", turnId: "t", createdAt: 0,
  role: "assistant", kind: "result", text: "",
  status: "streaming", targetId: "t1",
};

function renderTurnView(toolActivity?: Record<string, string>) {
  return render(
    <TurnView
      prompts={[]}
      results={[result]}
      layout="vertical"
      customPrompts={{}}
      onToggleLayout={() => {}}
      onStop={() => {}}
      onRetry={() => {}}
      toolActivity={toolActivity}
    />,
  );
}

describe("TurnView tool activity note", () => {
  it("يعرض ملاحظة البحث عندما تكون هناك أداة نشطة لهدف له نتيجة", () => {
    renderTurnView({ t1: "search_documents" });
    expect(screen.getByText("جارٍ البحث في مستنداتك…")).toBeInTheDocument();
  });

  it("لا يعرض ملاحظة البحث عندما تكون toolActivity فارغة", () => {
    renderTurnView({});
    expect(screen.queryByText("جارٍ البحث في مستنداتك…")).not.toBeInTheDocument();
  });

  it("لا يعرض ملاحظة البحث عندما تكون toolActivity غير معرّفة", () => {
    renderTurnView(undefined);
    expect(screen.queryByText("جارٍ البحث في مستنداتك…")).not.toBeInTheDocument();
  });

  it("لا يعرض ملاحظة البحث عندما لا تطابق الأداة النشطة أي نتيجة", () => {
    renderTurnView({ otherTarget: "search_documents" });
    expect(screen.queryByText("جارٍ البحث في مستنداتك…")).not.toBeInTheDocument();
  });
});
