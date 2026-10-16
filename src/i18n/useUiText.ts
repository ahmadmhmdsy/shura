import { useSyncExternalStore } from "react";
import { uiText, type UiText } from "./UiText";

/**
 * React binding for the shared UiText instance. Subscribes the calling component to
 * locale changes, so switching language re-renders every consumer.
 */
export function useUiText(): UiText {
  useSyncExternalStore(uiText.subscribe, uiText.getLocale, uiText.getLocale);
  return uiText;
}
