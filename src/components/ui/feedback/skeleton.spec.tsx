import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Skeleton, SkeletonGroup } from "./skeleton";

describe("الهيكل التحميلي", () => {
  it("يعرض عنصر الهيكل النصي افتراضيًا", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toBeTruthy();
  });

  it("يعرض عنصر الهيكل الدائري", () => {
    const { container } = render(<Skeleton variant="circular" />);
    expect(container.firstChild).toBeTruthy();
  });

  it("يعرض عنصر الهيكل المستطيل بعرض وارتفاع مخصصين", () => {
    const { container } = render(<Skeleton variant="rectangular" width={120} height={40} />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.width).toBe("120px");
    expect(el.style.height).toBe("40px");
  });

  it("يعرض مجموعة هياكل بعدد محدد", () => {
    const { container } = render(<SkeletonGroup count={4} />);
    const group = container.firstChild as HTMLElement;
    expect(group.children.length).toBe(4);
  });
});
