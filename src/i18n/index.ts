export { UiText, uiText } from "./UiText";
import { uiText } from "./UiText";
import type { PluralKey, ResourceKey } from "./en";
import type { TextArgs } from "./UiText";

/** Non-React shorthand for the shared instance: t("chat.send"). */
export const t = (key: ResourceKey, args?: TextArgs): string => uiText.t(key, args);
/** Non-React shorthand for the shared instance: plural("rag.chipIndexed", n). */
export const plural = (key: PluralKey, count: number, args?: TextArgs): string => uiText.plural(key, count, args);
export type { TextArgs, Translate } from "./UiText";
export { useUiText } from "./useUiText";
export { en } from "./en";
export type { ResourceKey, PluralKey, Resources, EnResources } from "./en";
export { ar } from "./ar";
export {
  LOCALES,
  LOCALE_DIRECTION,
  DEFAULT_LOCALE,
  NUMBERING_SYSTEM,
  REQUIRED_PLURAL_CATEGORIES,
  isLocale,
} from "./types";
export type { Locale, PluralCategory, PluralForms } from "./types";
