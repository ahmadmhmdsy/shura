import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { StartupNoticeBanner } from "./StartupNotice";

describe("StartupNoticeBanner", () => {
  it("يعرض كل التفاصيل ويتيح إخفاؤها", () => {
    const onDismiss = vi.fn();
    render(
      <StartupNoticeBanner
        notice={{ title: "تقرير استرجاع الأرشيف", details: ["عُزل أرشيف تالف: quarantine/a", "تعذر قراءة المجلد"] }}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("عُزل أرشيف تالف: quarantine/a")).toBeInTheDocument();
    expect(screen.getByText("تعذر قراءة المجلد")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إخفاء" }));
    expect(onDismiss).toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("يعمل بلا معالج إخفاء", () => {
    render(<StartupNoticeBanner notice={{ title: "تنبيه", details: ["تفصيل"] }} />);
    fireEvent.click(screen.getByRole("button", { name: "إخفاء" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
