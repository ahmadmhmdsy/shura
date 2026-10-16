import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAppShortcuts } from "./useAppShortcuts";
import { useSessionsStore } from "@/state/sessionsStore";
import { getMetrics } from "@/lib/logging";
import { ar } from "@/i18n/ar";

function createKeyboardEvent(init: { key: string; ctrlKey?: boolean; shiftKey?: boolean }): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key: init.key,
    ctrlKey: init.ctrlKey ?? false,
    shiftKey: init.shiftKey ?? false,
    bubbles: true,
    cancelable: true,
  });
}

let unmount: (() => void) | undefined;

afterEach(() => {
  unmount?.();
  unmount = undefined;
  document.body.innerHTML = "";
  useSessionsStore.setState({ sessions: [], currentId: null, messages: [], loading: false, loadGeneration: 0, openGeneration: 0 });
});

function setup() {
  const onOpenSettings = vi.fn();
  const onShowHelp = vi.fn();
  const onToggleTheme = vi.fn();
  const hook = renderHook(() => useAppShortcuts({ onOpenSettings, onShowHelp, onToggleTheme }));
  unmount = hook.unmount;
  return { onOpenSettings, onShowHelp, onToggleTheme, ...hook };
}

describe("useAppShortcuts", () => {
  it("يعيد قائمة الاختصارات مع أوصافها، وتلحقها صفوف عرض الدردشة", () => {
    const { result } = setup();
    expect(result.current).toHaveLength(9);
    expect(result.current.map((s) => s.key)).toEqual(["k", "n", "s", "Escape", "?", ",", "/", "Enter", "1-9"]);
    expect(result.current[0].description).toBe(ar.keyboard.search);
    expect(result.current[1].description).toBe(ar.keyboard.newSession);
    expect(result.current[2].description).toBe(ar.keyboard.settings);
    expect(result.current[3].description).toBe(ar.keyboard.stop);
    expect(result.current[4].description).toBe(ar.keyboard.help);
    expect(result.current[5].description).toBe(ar.keyboard.settings);
    expect(result.current[6].description).toBe(ar.keyboard.toggleTheme);
    expect(result.current[7].description).toBe(ar.keyboard.send);
    expect(result.current[8].description).toBe(ar.keyboard.focusTarget);
    // The two chat rows are display-only: the help list shows them, registerShortcuts skips them.
    expect(result.current[7].displayOnly).toBe(true);
    expect(result.current[8].displayOnly).toBe(true);
    expect(result.current[7].action).toBeUndefined();
    expect(result.current[8].action).toBeUndefined();
  });

  it("Ctrl+K يركّز حقل البحث في الجلسات", () => {
    setup();
    const input = document.createElement("input");
    input.setAttribute("aria-label", ar.sessions.search);
    document.body.appendChild(input);
    window.dispatchEvent(createKeyboardEvent({ key: "k", ctrlKey: true }));
    expect(document.activeElement).toBe(input);
  });

  it("Ctrl+N ينشئ جلسة جديدة ويزايد عدّاد الجلسات", async () => {
    setup();
    const before = useSessionsStore.getState().sessions.length;
    const beforeCount = getMetrics().sessionCount;
    window.dispatchEvent(createKeyboardEvent({ key: "n", ctrlKey: true }));
    await waitFor(() => expect(useSessionsStore.getState().sessions.length).toBe(before + 1));
    expect(getMetrics().sessionCount).toBe(beforeCount + 1);
  });

  it("Ctrl+Shift+S يفتح الإعدادات", () => {
    const { onOpenSettings } = setup();
    window.dispatchEvent(createKeyboardEvent({ key: "s", ctrlKey: true, shiftKey: true }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("Escape يوقف التوليد بإرسال حدث «shura:stop-generation»", () => {
    setup();
    const onStop = vi.fn();
    window.addEventListener("shura:stop-generation", onStop);
    const event = createKeyboardEvent({ key: "Escape" });
    window.dispatchEvent(event);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    window.removeEventListener("shura:stop-generation", onStop);
  });

  it("Escape لا يوقف التوليد أثناء الكتابة في حقل نصي", () => {
    setup();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const onStop = vi.fn();
    window.addEventListener("shura:stop-generation", onStop);
    window.dispatchEvent(createKeyboardEvent({ key: "Escape" }));
    expect(onStop).not.toHaveBeenCalled();
    window.removeEventListener("shura:stop-generation", onStop);
  });

  it("? يفتح المساعدة", () => {
    const { onShowHelp } = setup();
    window.dispatchEvent(createKeyboardEvent({ key: "?" }));
    expect(onShowHelp).toHaveBeenCalledTimes(1);
  });

  it("? لا يفتح المساعدة أثناء الكتابة في حقل نصي", () => {
    const { onShowHelp } = setup();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    window.dispatchEvent(createKeyboardEvent({ key: "?" }));
    expect(onShowHelp).not.toHaveBeenCalled();
  });

  it("Ctrl+, يفتح الإعدادات", () => {
    const { onOpenSettings } = setup();
    window.dispatchEvent(createKeyboardEvent({ key: ",", ctrlKey: true }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+/ يبدّل المظهر", () => {
    const { onToggleTheme } = setup();
    window.dispatchEvent(createKeyboardEvent({ key: "/", ctrlKey: true }));
    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });

  it("إزالة المستمع عند إزالة المكوّن", () => {
    const { onOpenSettings } = setup();
    unmount?.();
    unmount = undefined;
    window.dispatchEvent(createKeyboardEvent({ key: "s", ctrlKey: true, shiftKey: true }));
    expect(onOpenSettings).not.toHaveBeenCalled();
  });
});
