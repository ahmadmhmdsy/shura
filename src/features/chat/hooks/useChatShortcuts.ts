import { useEffect, useRef } from "react";

/**
 * Chat-scoped keyboard shortcuts: Ctrl+Enter sends, Escape stops streaming.
 * The handler ref avoids stale closures without re-subscribing the listener.
 */
export function useChatShortcuts(doSend: () => void, cancel: () => void, sending: boolean): void {
  const keyboardHandlerRef = useRef({ doSend: () => {}, cancel: () => {} });
  // eslint-disable-next-line react-hooks/refs -- ref pattern avoids stale closures
  keyboardHandlerRef.current = { doSend: () => void doSend(), cancel: () => cancel() };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === "Enter") {
        event.preventDefault();
        keyboardHandlerRef.current.doSend();
      }
      if (event.key === "Escape" && sending) {
        event.preventDefault();
        keyboardHandlerRef.current.cancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sending]);
}
