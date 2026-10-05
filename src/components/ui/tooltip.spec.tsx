import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, "ResizeObserver", {
    writable: true,
    value: ResizeObserverMock,
  });
});

function renderTooltip() {
  return render(
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button">زر التلميح</button>
        </TooltipTrigger>
        <TooltipContent>نص التلميح</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

describe("التلميح", () => {
  it("لا يعرض التلميح قبل التفاعل مع الزناد", () => {
    renderTooltip();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("يعرض نص التلميح عند التحويم فوق الزناد", async () => {
    renderTooltip();
    await userEvent.hover(screen.getByRole("button", { name: "زر التلميح" }));
    expect(await screen.findByRole("tooltip")).toBeTruthy();
  });

  it("يعرض نص التلميح عند التركيز على الزناد", async () => {
    renderTooltip();
    await userEvent.tab();
    expect(await screen.findByRole("tooltip")).toBeTruthy();
  });
});
