import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown";

describe("Markdown", () => {
  it("يعرض العناصر الأساسية (عريض ورمز)", () => {
    render(<Markdown text={"**مهم** و`كود`"} />);
    expect(screen.getByText("مهم").tagName).toBe("STRONG");
    expect(screen.getByText("كود").tagName).toBe("CODE");
  });
  it("يدعم جداول GFM", () => {
    render(<Markdown text={"| أ | ب |\n|---|---|\n| 1 | 2 |"} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});
