import { beforeAll, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { Toaster } from "./sonner";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

describe("التنبيهات", () => {
  it("يعرض التنبيه عند استدعاء toast", async () => {
    render(<Toaster />);
    await act(async () => {
      toast.success("تم الحفظ بنجاح");
    });
    expect(await screen.findByText("تم الحفظ بنجاح")).toBeTruthy();
  });
});
