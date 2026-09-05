import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";

describe("App smoke", () => {
  it("يعرض هيكل شورى RTL", () => {
    render(<App />);
    expect(screen.getByText(/شورى/)).toBeInTheDocument();
  });
});
