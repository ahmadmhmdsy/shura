import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";
import { uiText } from "./i18n";

describe("App smoke", () => {
  it("يعرض هيكل شورى RTL", () => {
    render(<App />);
    expect(screen.getByText(/شورى/)).toBeInTheDocument();
  });

  // [T5.3-f2] The empty state is the only screen that is not ChatScreen, and ChatScreen is the only
  // other place that renders <main>. Without this, the first-run screen has no main landmark at all
  // (axe's landmark-one-main is a best-practice rule, so the a11y gate cannot catch it).
  it("يعرض معلم main في الشاشة الأولى", () => {
    render(<App />);
    expect(screen.getByText(uiText.t("chat.emptyStateTitle"))).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });
});