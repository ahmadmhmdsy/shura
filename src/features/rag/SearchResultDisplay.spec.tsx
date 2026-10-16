import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SearchResultDisplay, SearchResultIndicator } from "./SearchResultDisplay";
import type { SearchResult } from "./SearchResultDisplay";

const result = (over: Partial<SearchResult> = {}): SearchResult => ({
  chunkId: "c1",
  text: "نص القطعة الأولى",
  score: 0.856,
  source: "تقرير.pdf",
  documentId: "d1",
  ...over,
});

describe("SearchResultDisplay", () => {
  it("لا يعرض شيئًا عند عدم وجود نتائج", () => {
    const { container } = render(<SearchResultDisplay results={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("يعرض المصدر والنسبة والنص لكل نتيجة", () => {
    render(<SearchResultDisplay results={[result()]} />);

    expect(screen.getByText("نتائج البحث في المستندات:")).toBeTruthy();
    expect(screen.getByText("تقرير.pdf")).toBeTruthy();
    expect(screen.getByText("86%")).toBeTruthy();
    expect(screen.getByText("نص القطعة الأولى…")).toBeTruthy();
  });

  it("يعرض عدة نتائج", () => {
    render(
      <SearchResultDisplay
        results={[
          result({ chunkId: "c1", source: "أ.pdf", documentId: "d1" }),
          result({ chunkId: "c2", source: "ب.pdf", documentId: "d2", score: 0.5 }),
        ]}
      />,
    );

    expect(screen.getByText("أ.pdf")).toBeTruthy();
    expect(screen.getByText("ب.pdf")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
  });

  it("يقتصر النص على مئة محرف", () => {
    render(<SearchResultDisplay results={[result({ text: "أ".repeat(150) })]} />);

    expect(screen.getByText("أ".repeat(100) + "…")).toBeTruthy();
  });

  it("زر عرض يستدعي معالج المصدر", () => {
    const onViewSource = vi.fn();
    render(<SearchResultDisplay results={[result()]} onViewSource={onViewSource} />);

    fireEvent.click(screen.getByRole("button", { name: "عرض" }));

    expect(onViewSource).toHaveBeenCalledWith("d1");
  });

  it("لا يعرض زر عرض بدون معالج", () => {
    render(<SearchResultDisplay results={[result()]} />);

    expect(screen.queryByRole("button", { name: "عرض" })).toBeNull();
  });
});

describe("SearchResultIndicator", () => {
  it("لا يعرض شيئًا عند صفر نتائج", () => {
    const { container } = render(<SearchResultIndicator count={0} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("يعرض عدد النتائج", () => {
    render(<SearchResultIndicator count={3} />);

    expect(screen.getByText("3 نتائج بحث")).toBeTruthy();
  });
});
