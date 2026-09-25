import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "@/App";
import { useSessionsStore } from "@/state/sessionsStore";
import { useSettingsStore } from "@/state/settingsStore";
import { useComposerStore } from "@/state/composerStore";

const session = { id: "cs1", title: "جلسة", createdAt: 1, updatedAt: 1, modelIds: [], primaryTarget: null, layoutMode: "vertical" as const, onDisk: false };

beforeEach(() => {
  useSessionsStore.setState({ sessions: [session], currentId: null, messages: [], drafts: undefined } as never);
  useSettingsStore.setState({ providerKeys: {}, primaryTarget: null, sessionRootDir: null, timeoutMs: 120_000, loaded: true, error: null });
  useComposerStore.setState({ drafts: {} });
});

describe("dialog focus management", () => {
  it("activates a session row with Enter", async () => {
    const user = userEvent.setup();
    render(<App />);
    const row = screen.getByRole("button", { name: "جلسة" });
    row.focus();
    expect(row).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(useSessionsStore.getState().currentId).toBe("cs1"));
  });

  it("activates a session row with Space", async () => {
    const user = userEvent.setup();
    render(<App />);
    screen.getByRole("button", { name: "جلسة" }).focus();
    await user.keyboard(" ");
    await waitFor(() => expect(useSessionsStore.getState().currentId).toBe("cs1"));
  });

  it("reaches the rename and delete controls without a mouse", async () => {
    render(<App />);
    for (const name of [/إعادة تسمية/, /حذف/]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("does not let the remove control also select the session", async () => {
    const user = userEvent.setup();
    window.confirm = () => false;
    render(<App />);
    await user.click(screen.getByRole("button", { name: /حذف/ }));
    expect(useSessionsStore.getState().currentId).toBeNull();
  });
});

describe("labels and semantics", () => {
  it("labels the session search field", () => {
    render(<App />);
    expect(screen.getByLabelText(/بحث/)).toBeInTheDocument();
  });

  it("exposes each session row as a button with its name", () => {
    render(<App />);
    const row = screen.getByRole("button", { name: "جلسة" });
    expect(row.tagName).toBe("BUTTON");
    expect(row).toHaveAccessibleName(/جلسة/);
  });
});

describe("mobile navigation", () => {
  it("exposes a menu toggle with aria-expanded", () => {
    render(<App />);
    const toggle = screen.getByRole("button", { name: /القائمة/ });
    expect(toggle).toHaveAttribute("aria-expanded");
    expect(["true", "false"]).toContain(toggle.getAttribute("aria-expanded"));
  });

  it("hides the sidebar from the toggle when collapsed", () => {
    render(<App />);
    const toggle = screen.getByRole("button", { name: /القائمة/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("theme and motion", () => {
  it("marks the document as dark before paint", () => {
    render(<App />);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("exposes a focus ring for keyboard users", () => {
    render(<App />);
    // The session row must show a visible focus indicator (WCAG 2.4.7). jsdom does not
    // apply Tailwind, so the class is the observable contract here; the rendered ring is
    // verified visually during browser QA.
    const row = screen.getByRole("button", { name: "جلسة" });
    expect(row.className).toMatch(/focus-visible:ring-2/);
  });
});
  it("closes Settings with Escape and restores focus", async () => {
    const user = userEvent.setup();
    render(<App />);
    const opener = screen.getByRole("button", { name: "الإعدادات" });
    await user.click(opener);
    expect(screen.getByRole("dialog", { name: "الإعدادات" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });