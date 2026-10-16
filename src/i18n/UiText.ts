import { ar } from "./ar";
import { en, type PluralKey, type ResourceKey, type Resources } from "./en";
import {
  DEFAULT_LOCALE,
  LOCALE_DIRECTION,
  NUMBERING_SYSTEM,
  type Locale,
  type PluralCategory,
  type PluralForms,
} from "./types";

const RESOURCES: Record<Locale, Resources> = { en, ar };

/** CLDR plural rules for the locales this app ships. */
const PLURAL_RULES: Record<Locale, (count: number) => PluralCategory> = {
  en: (count) => (count === 1 ? "one" : "other"),
  // Arabic: zero / one / two / few (3-10) / many (11-99) / other.
  ar: (count) => {
    if (count === 0) return "zero";
    if (count === 1) return "one";
    if (count === 2) return "two";
    const mod100 = count % 100;
    if (mod100 >= 3 && mod100 <= 10) return "few";
    if (mod100 >= 11 && mod100 <= 99) return "many";
    return "other";
  },
};

export type TextArgs = Record<string, string | number>;

/**
 * [T3.2b] شكل الدالة `t`: الوحدات التي تستقبل مترجمًا (حدود الخطأ، خرائط العرض) تعتمد
 * هذا النوع بدل الاعتماد على `UiText` نفسه، فيبقى تعريف واحد في طبقة i18n وحدها.
 */
export type Translate = (key: ResourceKey, args?: TextArgs) => string;

/**
 * The single entry point for user-visible text and locale-aware formatting.
 *
 * React components read it through useUiText(); non-React modules use the shared
 * uiText instance. Never hardcode a user-visible string, number, or date format.
 */
export class UiText {
  private locale: Locale;
  private readonly listeners = new Set<() => void>();

  constructor(locale: Locale = DEFAULT_LOCALE) {
    this.locale = locale;
  }

  /** Stable reference, safe for useSyncExternalStore. */
  getLocale = (): Locale => this.locale;

  /** Stable reference, safe for useSyncExternalStore. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  setLocale(locale: Locale): void {
    if (locale === this.locale) return;
    this.locale = locale;
    this.applyDocumentLocale();
    for (const listener of this.listeners) listener();
  }

  /** Look up a plain string, interpolating {placeholders}. Bound, so it can be destructured. */
  t = (key: ResourceKey, args?: TextArgs): string => {
    const value = resolve(RESOURCES[this.locale], key);
    if (typeof value !== "string") throw new Error("Missing text resource: " + key + " (" + this.locale + ")");
    return interpolate(value, args);
  };

  /** Look up a counted string using the locale's CLDR plural category. Bound, so it can be destructured. */
  plural = (key: PluralKey, count: number, args?: TextArgs): string => {
    const value = resolve(RESOURCES[this.locale], key);
    if (!isPluralForms(value)) throw new Error("Missing plural resource: " + key + " (" + this.locale + ")");
    const category = PLURAL_RULES[this.locale](count);
    return interpolate(value[category] ?? value.other, { count, ...args });
  };

  formatNumber = (value: number, options?: Intl.NumberFormatOptions): string =>
    new Intl.NumberFormat(this.locale, { numberingSystem: NUMBERING_SYSTEM, ...options }).format(value);

  formatDate = (value: Date | number, options?: Intl.DateTimeFormatOptions): string =>
    new Intl.DateTimeFormat(this.locale, { numberingSystem: NUMBERING_SYSTEM, ...options }).format(value);

  formatUnit = (value: number, unit: Intl.NumberFormatOptions["unit"], options?: Intl.NumberFormatOptions): string =>
    new Intl.NumberFormat(this.locale, { numberingSystem: NUMBERING_SYSTEM, style: "unit", unit, ...options }).format(value);

  /**
   * Applies the locale to the document: dir/lang on <html> and the localized app name as
   * the title. A no-op outside the DOM (tests, SSR). Called by setLocale and once at boot.
   */
  applyDocumentLocale(): void {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.setAttribute("dir", LOCALE_DIRECTION[this.locale]);
    root.setAttribute("lang", this.locale);
    document.title = this.t("app.name");
  }
}

function resolve(resources: unknown, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined),
      resources,
    );
}

function isPluralForms(value: unknown): value is PluralForms {
  return typeof value === "object" && value !== null && typeof (value as PluralForms).other === "string";
}

function interpolate(template: string, args?: TextArgs): string {
  if (!args) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = args[name];
    return value === undefined ? match : String(value);
  });
}

/** The shared instance every non-React module uses. */
export const uiText = new UiText(DEFAULT_LOCALE);
