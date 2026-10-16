/**
 * Shared types for the localization layer.
 *
 * Design goal: adding a key to the English source of truth must be a compile error
 * in every other locale until it is translated, and adding a language must be one
 * registry entry plus one resource file.
 */

export const LOCALES = ["en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];

/** CLDR plural categories. Arabic uses all six; English uses one/other. */
export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

/** A counted string: `other` is required, the rest are locale-dependent. */
export type PluralForms = { other: string } & Partial<Record<Exclude<PluralCategory, "other">, string>>;

/** CLDR categories each locale is required to provide for every plural key. */
export const REQUIRED_PLURAL_CATEGORIES: Record<Locale, readonly PluralCategory[]> = {
  en: ["one", "other"],
  ar: ["zero", "one", "two", "few", "many", "other"],
};

export const LOCALE_DIRECTION: Record<Locale, "ltr" | "rtl"> = { en: "ltr", ar: "rtl" };

/** Arabic-first app: the UI starts in Arabic even though `en` is the source of truth. */
export const DEFAULT_LOCALE: Locale = "ar";

/** Locked decision D1: Latin digits everywhere, including Arabic. */
export const NUMBERING_SYSTEM = "latn";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Same shape as the English source of truth with every leaf widened: string leaves
 * become `string`, plural leaves become `PluralForms`. Translation files are typed
 * against this, so a missing or extra key is a compile error while translated
 * values stay free.
 */
export type ResourceShape<T> = {
  [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends PluralForms
      ? PluralForms
      : T[K] extends object
        ? ResourceShape<T[K]>
        : never;
};

/** Dotted paths to plain string leaves, e.g. "chat.send". */
export type StringPaths<T> = T extends object
  ? {
      [K in keyof T & string]: T[K] extends string
        ? K
        : T[K] extends PluralForms
          ? never
          : T[K] extends object
            ? `${K}.${StringPaths<T[K]>}`
            : never;
    }[keyof T & string]
  : never;

/** Dotted paths to plural leaves, e.g. "rag.chipIndexed". */
export type PluralPaths<T> = T extends object
  ? {
      [K in keyof T & string]: T[K] extends PluralForms
        ? K
        : T[K] extends object
          ? `${K}.${PluralPaths<T[K]>}`
          : never;
    }[keyof T & string]
  : never;
