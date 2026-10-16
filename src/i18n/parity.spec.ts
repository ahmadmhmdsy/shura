import { afterEach, describe, expect, it } from "vitest";
import { en, type Resources } from "./en";
import { ar } from "./ar";
import { uiText } from "./UiText";
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_DIRECTION,
  NUMBERING_SYSTEM,
  REQUIRED_PLURAL_CATEGORIES,
  isLocale,
  type Locale,
} from "./types";

/**
 * Catalog parity: adding a key to the English source of truth must be caught here if it
 * is not translated, and a translation must never invent a placeholder the source lacks.
 */
interface StringLeaf { path: string; kind: "string"; value: string }
interface PluralLeaf { path: string; kind: "plural"; value: Record<string, string> }
type Leaf = StringLeaf | PluralLeaf;

/** Every leaf of a resource tree, in declaration order, with its dotted path. */
function leaves(node: unknown, prefix = ""): Leaf[] {
  if (typeof node === "string") return [{ path: prefix, kind: "string", value: node }];
  if (!node || typeof node !== "object") return [];
  const record = node as Record<string, unknown>;
  if (typeof record.other === "string") {
    return [{ path: prefix, kind: "plural", value: record as Record<string, string> }];
  }
  return Object.keys(record).flatMap((key) => leaves(record[key], prefix ? prefix + "." + key : key));
}

function placeholders(text: string): string[] {
  return (text.match(/\{[A-Za-z0-9_]+\}/g) ?? []).sort();
}

function distinct(values: string[]): string[] {
  return Array.from(new Set(values.flatMap(placeholders))).sort();
}

function valuesOf(leaf: Leaf): string[] {
  return leaf.kind === "string" ? [leaf.value] : Object.values(leaf.value);
}

/** Dummy arguments for every placeholder a leaf declares, so nothing stays un-interpolated. */
function argsFor(values: string[]): Record<string, string> {
  const names = new Set(values.flatMap((value) => placeholders(value).map((token) => token.slice(1, -1))));
  return Object.fromEntries(Array.from(names).map((name) => [name, "x"]));
}

const CATALOGS: Record<Locale, Resources> = { en, ar };
const enLeaves = leaves(en);
const arLeaves = leaves(ar);

afterEach(() => {
  uiText.setLocale(DEFAULT_LOCALE);
});

describe("locale registry", () => {
  it("gives every locale a catalog and a direction", () => {
    expect(Object.keys(CATALOGS).sort()).toEqual([...LOCALES].sort());
    expect(Object.keys(LOCALE_DIRECTION).sort()).toEqual([...LOCALES].sort());
  });

  it("declares a default locale that exists", () => {
    expect(isLocale(DEFAULT_LOCALE)).toBe(true);
    expect(LOCALES).toContain(DEFAULT_LOCALE);
  });

  it("pins the numbering system so digits do not drift per locale (D1)", () => {
    expect(NUMBERING_SYSTEM).toBe("latn");
  });

  it("rejects unknown locale codes", () => {
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(7)).toBe(false);
  });
});

describe("catalog parity", () => {
  it("ar declares exactly the same leaf paths as the en source of truth", () => {
    expect(arLeaves.map((leaf) => leaf.path)).toEqual(enLeaves.map((leaf) => leaf.path));
  });

  it("never leaves a leaf empty", () => {
    const catalogs: [string, Leaf[]][] = [["en", enLeaves], ["ar", arLeaves]];
    for (const [locale, list] of catalogs) {
      for (const leaf of list) {
        for (const value of valuesOf(leaf)) {
          expect(value.trim(), locale + ":" + leaf.path).not.toBe("");
        }
      }
    }
  });

  it("treats a key as plural in every locale or in none", () => {
    const enKind = new Map(enLeaves.map((leaf) => [leaf.path, leaf.kind]));
    for (const leaf of arLeaves) {
      expect(enKind.get(leaf.path), leaf.path).toBe(leaf.kind);
    }
  });

  it("provides every CLDR category the locale requires for each plural key", () => {
    for (const locale of LOCALES) {
      for (const leaf of leaves(CATALOGS[locale])) {
        if (leaf.kind !== "plural") continue;
        for (const category of REQUIRED_PLURAL_CATEGORIES[locale]) {
          expect(leaf.value[category], locale + ":" + leaf.path + "." + category).toBeTypeOf("string");
        }
      }
    }
  });

  it("never introduces a placeholder the English source lacks", () => {
    const enByPath = new Map(enLeaves.map((leaf) => [leaf.path, leaf]));
    for (const leaf of arLeaves) {
      const source = enByPath.get(leaf.path);
      if (!source) continue;
      const allowed = distinct(valuesOf(source));
      for (const used of distinct(valuesOf(leaf))) {
        expect(allowed, leaf.path + " uses {" + used + "}").toContain(used);
      }
    }
  });
});

describe("runtime lookup", () => {
  it("resolves every string key in every locale with its placeholders filled", () => {
    for (const locale of LOCALES) {
      uiText.setLocale(locale);
      for (const leaf of leaves(CATALOGS[locale])) {
        if (leaf.kind !== "string") continue;
        const rendered = uiText.t(leaf.path as never, argsFor(valuesOf(leaf)));
        expect(rendered.length, locale + ":" + leaf.path).toBeGreaterThan(0);
        expect(rendered, locale + ":" + leaf.path).not.toContain("{");
      }
    }
  });

  it("resolves every plural key for counts 0..200 in every locale", () => {
    for (const locale of LOCALES) {
      uiText.setLocale(locale);
      for (const leaf of leaves(CATALOGS[locale])) {
        if (leaf.kind !== "plural") continue;
        for (let count = 0; count <= 200; count++) {
          const rendered = uiText.plural(leaf.path as never, count, argsFor(valuesOf(leaf)));
          expect(rendered.length, locale + ":" + leaf.path + "@" + count).toBeGreaterThan(0);
          expect(rendered, locale + ":" + leaf.path + "@" + count).not.toContain("{");
        }
      }
    }
  });
});
