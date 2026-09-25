import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown";

// Model output is untrusted input: it must never load a remote resource or steer
// navigation, because a provider (or a poisoned archive) can author this text.
describe("Markdown security", () => {
  it("removes remote images and unsafe links", () => {
    render(<Markdown text="![tracker](https://tracker.invalid/pixel) [run](javascript:alert(1))" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("keeps the alt text of a removed image", () => {
    render(<Markdown text="![tracker pixel](https://tracker.invalid/pixel)" />);
    expect(screen.getByText("tracker pixel")).toBeInTheDocument();
  });

  it("renders a normal https link as non-clickable text", () => {
    render(<Markdown text="[docs](https://example.com/docs)" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();
  });

  it("does not load data-uri images either", () => {
    const { container } = render(<Markdown text={`![x](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)`} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain("data:image");
  });

  it("neutralizes raw HTML and script injection", () => {
    const { container } = render(<Markdown text={'<script>window.__pwned = 1</script><img src=x onerror="window.__pwned=2">'} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("does not let a link carry a javascript: target or rel bypass", () => {
    const { container } = render(<Markdown text="[click](javascript:window.__pwned=3)" />);
    expect(container.querySelector("a")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("renders normal prose, lists, and code untouched", () => {
    const { container } = render(<Markdown text={"# عنوان\n\n- عنصر\n\n`code`"} />);
    expect(container.querySelector("h1")).not.toBeNull();
    expect(container.querySelector("li")).not.toBeNull();
    expect(container.querySelector("code")).not.toBeNull();
  });

  it("does not execute an event handler written as markdown html", () => {
    const { container } = render(<Markdown text={'<div onmouseover="window.__pwned=4">hover</div>'} />);
    expect(container.querySelector("div[onmouseover]")).toBeNull();
  });
});
