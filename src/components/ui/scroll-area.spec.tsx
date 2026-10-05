import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScrollArea } from "./scroll-area";

describe("منطقة التمرير", () => {
  it("تعرض المحتوى داخل منطقة التمرير", () => {
    render(
      <ScrollArea>
        <div>محتوى قابل للتمرير</div>
      </ScrollArea>
    );
    expect(screen.getByText("محتوى قابل للتمرير")).toBeTruthy();
  });

  it("تدعم تمرير فئة مخصصة مع بقاء المحتوى ظاهرًا", () => {
    render(
      <ScrollArea className="my-scroll-area">
        <div>محتوى آخر</div>
      </ScrollArea>
    );
    expect(screen.getByText("محتوى آخر")).toBeTruthy();
  });
});
