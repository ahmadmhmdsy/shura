import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Separator } from "./separator";

describe("الفاصل", () => {
  it("يعرض فاصلًا أفقيًا افتراضيًا", () => {
    render(<Separator decorative={false} />);
    expect(screen.getByRole("separator")).toBeTruthy();
  });

  it("يعرض فاصلًا عموديًا عند تمرير الاتجاه", () => {
    render(<Separator decorative={false} orientation="vertical" />);
    expect(screen.getByRole("separator")).toBeTruthy();
  });
});
