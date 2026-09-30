import { describe, expect, it, vi } from "vitest";
import { isShortcutMatch, registerShortcuts, type Shortcut } from "./shortcuts";

function createKeyboardEvent(init: {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key: init.key,
    ctrlKey: init.ctrlKey ?? false,
    shiftKey: init.shiftKey ?? false,
    altKey: init.altKey ?? false,
    metaKey: init.metaKey ?? false,
    bubbles: true,
    cancelable: true,
  });
}

describe("isShortcutMatch", () => {
  it("matches Ctrl+K", () => {
    const shortcut: Shortcut = { key: "k", ctrl: true, action: () => {}, description: "Search" };
    expect(isShortcutMatch(createKeyboardEvent({ key: "k", ctrlKey: true }), shortcut)).toBe(true);
  });

  it("matches Ctrl+Shift+S", () => {
    const shortcut: Shortcut = { key: "s", ctrl: true, shift: true, action: () => {}, description: "Settings" };
    expect(isShortcutMatch(createKeyboardEvent({ key: "s", ctrlKey: true, shiftKey: true }), shortcut)).toBe(true);
  });

  it("matches Escape", () => {
    const shortcut: Shortcut = { key: "Escape", action: () => {}, description: "Stop" };
    expect(isShortcutMatch(createKeyboardEvent({ key: "Escape" }), shortcut)).toBe(true);
  });

  it("matches ?", () => {
    const shortcut: Shortcut = { key: "?", action: () => {}, description: "Help" };
    expect(isShortcutMatch(createKeyboardEvent({ key: "?", shiftKey: true }), shortcut)).toBe(true);
  });

  it("does not match Ctrl+K without Ctrl", () => {
    const shortcut: Shortcut = { key: "k", ctrl: true, action: () => {}, description: "Search" };
    expect(isShortcutMatch(createKeyboardEvent({ key: "k" }), shortcut)).toBe(false);
  });

  it("does not match Ctrl+K with Shift", () => {
    const shortcut: Shortcut = { key: "k", ctrl: true, action: () => {}, description: "Search" };
    expect(isShortcutMatch(createKeyboardEvent({ key: "k", ctrlKey: true, shiftKey: true }), shortcut)).toBe(false);
  });

  it("does not match Ctrl+S with Ctrl+Shift+S", () => {
    const shortcut: Shortcut = { key: "s", ctrl: true, shift: true, action: () => {}, description: "Settings" };
    expect(isShortcutMatch(createKeyboardEvent({ key: "s", ctrlKey: true }), shortcut)).toBe(false);
  });

  it("does not match different key", () => {
    const shortcut: Shortcut = { key: "k", ctrl: true, action: () => {}, description: "Search" };
    expect(isShortcutMatch(createKeyboardEvent({ key: "n", ctrlKey: true }), shortcut)).toBe(false);
  });

  it("matches Ctrl+Alt+K", () => {
    const shortcut: Shortcut = { key: "k", ctrl: true, alt: true, action: () => {}, description: "Search" };
    expect(isShortcutMatch(createKeyboardEvent({ key: "k", ctrlKey: true, altKey: true }), shortcut)).toBe(true);
  });

  it("does not match Ctrl+Alt+K without Alt", () => {
    const shortcut: Shortcut = { key: "k", ctrl: true, alt: true, action: () => {}, description: "Search" };
    expect(isShortcutMatch(createKeyboardEvent({ key: "k", ctrlKey: true }), shortcut)).toBe(false);
  });

  it("matches Meta+K (macOS)", () => {
    const shortcut: Shortcut = { key: "k", ctrl: true, action: () => {}, description: "Search" };
    expect(isShortcutMatch(createKeyboardEvent({ key: "k", metaKey: true }), shortcut)).toBe(true);
  });
});

describe("registerShortcuts", () => {
  it("calls action when shortcut is pressed", () => {
    const action = vi.fn();
    const shortcuts: Shortcut[] = [{ key: "k", ctrl: true, action, description: "Search" }];
    registerShortcuts(shortcuts);

    window.dispatchEvent(createKeyboardEvent({ key: "k", ctrlKey: true }));
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("does not call action when shortcut is not pressed", () => {
    const action = vi.fn();
    const shortcuts: Shortcut[] = [{ key: "k", ctrl: true, action, description: "Search" }];
    registerShortcuts(shortcuts);

    window.dispatchEvent(createKeyboardEvent({ key: "n", ctrlKey: true }));
    expect(action).not.toHaveBeenCalled();
  });

  it("cleanup removes the listener", () => {
    const action = vi.fn();
    const shortcuts: Shortcut[] = [{ key: "k", ctrl: true, action, description: "Search" }];
    const cleanup = registerShortcuts(shortcuts);

    window.dispatchEvent(createKeyboardEvent({ key: "k", ctrlKey: true }));
    expect(action).toHaveBeenCalledTimes(1);

    cleanup();
    window.dispatchEvent(createKeyboardEvent({ key: "k", ctrlKey: true }));
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("respects the when condition", () => {
    const action = vi.fn();
    const shortcuts: Shortcut[] = [{ key: "k", ctrl: true, action, description: "Search", when: () => false }];
    registerShortcuts(shortcuts);

    window.dispatchEvent(createKeyboardEvent({ key: "k", ctrlKey: true }));
    expect(action).not.toHaveBeenCalled();
  });

  it("prevents default on match", () => {
    const action = vi.fn();
    const shortcuts: Shortcut[] = [{ key: "k", ctrl: true, action, description: "Search" }];
    registerShortcuts(shortcuts);

    const event = createKeyboardEvent({ key: "k", ctrlKey: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("does not prevent default on non-match", () => {
    const action = vi.fn();
    const shortcuts: Shortcut[] = [{ key: "k", ctrl: true, action, description: "Search" }];
    registerShortcuts(shortcuts);

    const event = createKeyboardEvent({ key: "n", ctrlKey: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
