import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useChatShortcuts } from "./useChatShortcuts";

function createKeyboardEvent(init: { key: string; ctrlKey?: boolean }): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key: init.key,
    ctrlKey: init.ctrlKey ?? false,
    bubbles: true,
    cancelable: true,
  });
}

let unmount: (() => void) | undefined;

afterEach(() => {
  unmount?.();
  unmount = undefined;
});

function setup(doSend: () => void = () => {}, cancel: () => void = () => {}, sending = false) {
  const hook = renderHook(() => useChatShortcuts(doSend, cancel, sending));
  unmount = hook.unmount;
  return hook;
}

describe("useChatShortcuts", () => {
  it("Ctrl+Enter يستدعي doSend ويمنع السلوك الافتراضي", () => {
    const doSend = vi.fn();
    setup(doSend);
    const event = createKeyboardEvent({ key: "Enter", ctrlKey: true });
    window.dispatchEvent(event);
    expect(doSend).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("Escape أثناء الإرسال يستدعي cancel ويمنع السلوك الافتراضي", () => {
    const cancel = vi.fn();
    setup(() => {}, cancel, true);
    const event = createKeyboardEvent({ key: "Escape" });
    window.dispatchEvent(event);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("Escape خارج الإرسال لا يستدعي cancel", () => {
    const cancel = vi.fn();
    setup(() => {}, cancel, false);
    window.dispatchEvent(createKeyboardEvent({ key: "Escape" }));
    expect(cancel).not.toHaveBeenCalled();
  });

  it("إزالة المستمع عند إزالة المكوّن", () => {
    const doSend = vi.fn();
    setup(doSend);
    unmount?.();
    unmount = undefined;
    window.dispatchEvent(createKeyboardEvent({ key: "Enter", ctrlKey: true }));
    expect(doSend).not.toHaveBeenCalled();
  });

  it("rerender بمعالج جديد يستدعي الأحدث دون إعادة تسجيل", () => {
    const first = vi.fn();
    const second = vi.fn();
    const hook = renderHook((doSend: () => void) => useChatShortcuts(doSend, () => {}, false), { initialProps: first });
    unmount = hook.unmount;
    hook.rerender(second);
    window.dispatchEvent(createKeyboardEvent({ key: "Enter", ctrlKey: true }));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("تغيير sending يعيد تسجيل المستمع", () => {
    const cancel = vi.fn();
    const hook = renderHook((sending: boolean) => useChatShortcuts(() => {}, cancel, sending), { initialProps: false });
    unmount = hook.unmount;
    hook.rerender(true);
    window.dispatchEvent(createKeyboardEvent({ key: "Escape" }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
