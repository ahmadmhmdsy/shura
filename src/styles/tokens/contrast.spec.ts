/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Design-token contrast contract (T5.2).
 *
 * The axe run in e2e/axe.spec.ts proves the states it can reach; this spec proves the token
 * algebra underneath them, where one lightness edit can silently break every screen at once.
 * It parses src/styles/tokens/*.css, resolves var() indirection, converts the OKLCH values to
 * sRGB and applies the WCAG 2 relative-luminance ratio.
 *
 * Five claims are asserted:
 *   1. every pair in CONTRACT meets its floor in BOTH themes;
 *   2. the conversion reproduces the ratios axe measured in T5.1 - a broken colour conversion
 *      cannot pass the table by drifting every number in the same direction;
 *   3. every text/background combination a component writes in one class list is declared in
 *      CONTRACT, so a new combination has to be given a floor;
 *   4. no component references a --sura-* token that no token file defines;
 *   5. every colour token in colors.css has a CONTRACT row or a documented reason in EXEMPT,
 *      so adding a token forces a contrast decision.
 *
 * Floors: 4.5:1 for body-size text (WCAG 1.4.3) and 3:1 for non-text indicators (WCAG 1.4.11:
 * focus indicator, invalid-state border, accent border of a selected control). Large text would
 * be 3:1, but every text pair here also renders at body size, so 4.5 is the honest floor.
 */

const TOKENS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(TOKENS_DIR, "..", "..");
const REPO_ROOT = path.resolve(SRC_DIR, "..");

const BODY_TEXT = 4.5;
/** WCAG 1.4.11: focus indicators, invalid-state borders, selected-control borders. */
const UI_INDICATOR = 3;

const DECLARATION = /(--sura-[a-z0-9-]+)\s*:\s*([^;]+);/g;
/** A flat selector block: capture the selector and its body up to the closing brace on its own line. */
const BLOCK = /(?:^|[\n])\s*([^@\n{}][^\n{}]*?)\s*[{]([\s\S]*?)[\n][}]/g;
const VAR_ONLY = /^var[(]\s*(--sura-[a-z0-9-]+)\s*[)]$/;
const OKLCH = /^oklch[(]\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*[/]\s*([\d.]+))?\s*[)]$/;
const HEX = /^#([0-9a-fA-F]{6})$/;

interface Tokens {
  light: Map<string, string>;
  dark: Map<string, string>;
}

function tokenFiles(): string[] {
  return fs
    .readdirSync(TOKENS_DIR)
    .filter((name) => name.endsWith(".css"))
    .map((name) => path.join(TOKENS_DIR, name));
}

/** Reads every token file; comments are stripped so a commented value cannot satisfy a lookup. */
function parseTokens(): Tokens {
  const tokens: Tokens = { light: new Map(), dark: new Map() };
  for (const file of tokenFiles()) {
    const css = fs.readFileSync(file, "utf8").replace(/[/][*][\s\S]*?[*][/]/g, "");
    for (const block of css.matchAll(BLOCK)) {
      const selector = block[1].trim();
      const theme = selector === ":root" ? tokens.light : selector === ".dark" ? tokens.dark : null;
      if (!theme) continue;
      for (const declaration of block[2].matchAll(DECLARATION)) theme.set(declaration[1], declaration[2].trim());
    }
  }
  return tokens;
}

interface Color {
  rgb: number[];
  alpha: number;
}

function parseColor(value: string): Color | null {
  const oklch = OKLCH.exec(value);
  if (oklch) {
    const l = Number(oklch[1]);
    const c = Number(oklch[2]);
    const h = (Number(oklch[3]) * Math.PI) / 180;
    const a = c * Math.cos(h);
    const b = c * Math.sin(h);
    const lCube = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const mCube = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const sCube = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const linear = [
      4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube,
      -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube,
      -0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube,
    ];
    const encode = (channel: number) => {
      const clamped = Math.min(1, Math.max(0, channel));
      return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
    };
    return { rgb: linear.map(encode), alpha: oklch[4] === undefined ? 1 : Number(oklch[4]) };
  }
  const hex = HEX.exec(value);
  if (hex) {
    const packed = parseInt(hex[1], 16);
    return { rgb: [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255].map((v) => v / 255), alpha: 1 };
  }
  if (value === "transparent") return { rgb: [0, 0, 0], alpha: 0 };
  return null;
}

function relativeLuminance(rgb: number[]): number {
  const linear = rgb.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(a: number[], b: number[]): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Source-over compositing in gamma-encoded sRGB, which is what the browser does for these fills. */
function composite(foreground: Color, backdrop: number[]): number[] {
  return foreground.rgb.map((channel, index) => foreground.alpha * channel + (1 - foreground.alpha) * backdrop[index]);
}

const TOKENS = parseTokens();

function resolve(theme: keyof Tokens, token: string): string {
  let value = TOKENS[theme].get(token);
  for (let hop = 0; hop < 5 && value !== undefined; hop += 1) {
    const indirect = VAR_ONLY.exec(value);
    if (!indirect) break;
    value = TOKENS[theme].get(indirect[1]);
  }
  if (value === undefined) throw new Error("undefined token " + token + " in the " + theme + " theme");
  return value;
}

function colorOf(theme: keyof Tokens, token: string): Color {
  const parsed = parseColor(resolve(theme, token));
  if (!parsed) throw new Error("not a colour: " + token + " = " + resolve(theme, token));
  return parsed;
}

interface ContractPair {
  fg: string;
  bg: string;
  floor: number;
  where: string;
  fgAlpha?: number;
  bgAlpha?: number;
  /** Surface the background is composited over first; defaults to --sura-surface-primary. */
  bgOver?: string;
}

const CONTRACT: ContractPair[] = [
  { fg: "--sura-text-primary", bg: "--sura-surface-primary", floor: BODY_TEXT, where: "globals.css body - the pair every screen inherits" },
  { fg: "--sura-text-secondary", bg: "--sura-surface-primary", floor: BODY_TEXT, where: "secondary text on the base surface (ResultCard, Composer)" },
  { fg: "--sura-text-tertiary", bg: "--sura-surface-primary", floor: BODY_TEXT, where: "tertiary text on the base surface (App, Composer)" },
  { fg: "--sura-text-primary", bg: "--sura-surface-secondary", floor: BODY_TEXT, where: "secondary button fill, ErrorBoundary detail" },
  { fg: "--sura-text-secondary", bg: "--sura-surface-secondary", floor: BODY_TEXT, where: "badge fill, ErrorBoundary detail" },
  { fg: "--sura-text-primary", bg: "--sura-surface-tertiary", floor: BODY_TEXT, where: "tertiary button fill" },
  { fg: "--sura-text-secondary", bg: "--sura-surface-tertiary", floor: BODY_TEXT, where: "badge on a tertiary chip" },
  { fg: "--sura-text-tertiary", bg: "--sura-surface-tertiary", floor: BODY_TEXT, where: "inactive tertiary chip" },
  { fg: "--sura-text-primary", bg: "--sura-surface-elevated", floor: BODY_TEXT, where: "dialog content and the --color-popover-foreground mapping" },
  { fg: "--sura-text-secondary", bg: "--sura-surface-elevated", floor: BODY_TEXT, where: "dialog description (dialog.tsx)" },
  { fg: "--sura-text-tertiary", bg: "--sura-surface-elevated", floor: BODY_TEXT, where: "tertiary text inside a dialog" },
  { fg: "--sura-text-primary", bg: "--sura-hover", floor: BODY_TEXT, where: "hovered rows and menu items (App, badge)" },
  { fg: "--sura-text-secondary", bg: "--sura-hover", floor: BODY_TEXT, where: "hovered rows (badge)" },
  { fg: "--sura-text-tertiary", bg: "--sura-hover", floor: BODY_TEXT, where: "hovered menu items (App, Composer)" },
  { fg: "--sura-text-primary", bg: "--sura-sidebar-bg", floor: BODY_TEXT, where: "sidebar title and active row label" },
  { fg: "--sura-text-secondary", bg: "--sura-sidebar-bg", floor: BODY_TEXT, where: "sidebar session meta (Sidebar)" },
  { fg: "--sura-text-tertiary", bg: "--sura-sidebar-bg", floor: BODY_TEXT, where: "sidebar captions and inactive labels" },
  { fg: "--sura-text-primary", bg: "--sura-sidebar-active", floor: BODY_TEXT, where: "label of the selected session row" },
  { fg: "--sura-accent-primary", bg: "--sura-sidebar-active", floor: BODY_TEXT, where: "icon of the selected session row" },
  { fg: "--sura-text-primary", bg: "--sura-sidebar-hover", floor: BODY_TEXT, where: "hovered sidebar row" },
  { fg: "--sura-text-secondary", bg: "--sura-sidebar-hover", floor: BODY_TEXT, where: "hovered sidebar row meta" },
  { fg: "--sura-text-tertiary", bg: "--sura-sidebar-hover", floor: BODY_TEXT, where: "hovered sidebar row caption" },
  { fg: "--sura-text-primary", bg: "--sura-input-bg", floor: BODY_TEXT, where: "input and textarea value text (inherited into the field)" },
  { fg: "--sura-input-placeholder", bg: "--sura-input-bg", floor: BODY_TEXT, where: "field placeholder (input.tsx, textarea.tsx)" },
  { fg: "--sura-accent-foreground", bg: "--sura-accent-primary", floor: BODY_TEXT, where: "user bubble, selection, active chip, primary button" },
  { fg: "--sura-accent-foreground", bg: "--sura-accent-secondary", floor: BODY_TEXT, where: "primary button hover" },
  { fg: "--sura-accent-primary", bg: "--sura-accent-muted", floor: BODY_TEXT, where: "accent button fill, empty-state icon tile" },
  { fg: "--sura-accent-primary", bg: "--sura-accent-muted", bgAlpha: 0.8, floor: BODY_TEXT, where: "accent button hover fill (button.tsx)" },
  { fg: "--sura-accent-primary", bg: "--sura-surface-primary", floor: BODY_TEXT, where: "accent text and icons; the same token is the focus-ring colour" },
  { fg: "--sura-accent-primary", bg: "--sura-surface-elevated", floor: BODY_TEXT, where: "accent text inside a dialog" },
  { fg: "--sura-error-foreground", bg: "--sura-error", floor: BODY_TEXT, where: "danger badge and button" },
  { fg: "--sura-error-foreground", bg: "--sura-error-secondary", floor: BODY_TEXT, where: "danger hover fill (T5.1)" },
  { fg: "--sura-error-text", bg: "--sura-error-muted", floor: BODY_TEXT, where: "sidebar error notice and the Sonner error toast (T5.1)" },
  { fg: "--sura-error-text", bg: "--sura-error-text", bgAlpha: 0.1, bgOver: "--sura-surface-elevated", floor: BODY_TEXT, where: "inline error callout (ResultCard, TurnView)" },
  { fg: "--sura-error-text", bg: "--sura-error-text", bgAlpha: 0.1, bgOver: "--sura-chat-assistant-bg", floor: BODY_TEXT, where: "inline error line inside an assistant bubble" },
  { fg: "--sura-error-text", bg: "--sura-sidebar-bg", floor: BODY_TEXT, where: "sidebar delete icon and retry link" },
  { fg: "--sura-success", bg: "--sura-success-muted", floor: BODY_TEXT, where: "success badge and toast" },
  { fg: "--sura-warning", bg: "--sura-warning-muted", floor: BODY_TEXT, where: "warning badge and toast" },
  { fg: "--sura-info", bg: "--sura-info-muted", floor: BODY_TEXT, where: "info badge and toast" },
  { fg: "--sura-chat-user-text", bg: "--sura-chat-user-bg", floor: BODY_TEXT, where: "user message bubble" },
  { fg: "--sura-chat-assistant-text", bg: "--sura-chat-assistant-bg", floor: BODY_TEXT, where: "assistant message bubble" },
  { fg: "--sura-chat-system-text", bg: "--sura-chat-system-bg", floor: BODY_TEXT, where: "system message bubble" },
  { fg: "--sura-input-border-focus", bg: "--sura-input-bg", floor: UI_INDICATOR, where: "focus indicator of a field" },
  { fg: "--sura-border-accent", bg: "--sura-surface-primary", floor: UI_INDICATOR, where: "accent border of a selected control" },
  { fg: "--sura-border-accent", bg: "--sura-surface-elevated", floor: UI_INDICATOR, where: "accent border inside a dialog" },
  { fg: "--sura-error", bg: "--sura-surface-primary", floor: UI_INDICATOR, where: "invalid-state border (aria-invalid)" },
  { fg: "--sura-error", bg: "--sura-input-bg", floor: UI_INDICATOR, where: "invalid-state border on a field" },
];

/**
 * Colour tokens that are deliberately not in CONTRACT, each with the reason. A token belongs
 * here only when no text or state indicator is rendered as this colour on a known surface.
 */
const EXEMPT: Record<string, string> = {
  "--sura-surface-overlay": "modal scrim painted behind content; never a text or indicator pair",
  "--sura-text-disabled": "inactive controls, which WCAG 1.4.3 exempts; no component reads it today",
  "--sura-text-inverse": "unreferenced; the contrast-on-accent role is owned by --sura-accent-foreground",
  "--sura-accent-tertiary": "unreferenced",
  "--sura-active": "unreferenced selected-state fill",
  "--sura-focus-ring": "translucent ring colour read only by --sura-shadow-focus, which no component applies; the live focus indicator is --sura-accent-primary",
  "--sura-border-primary": "1px decorative divider; each control it outlines also carries a text or icon label and a focus indicator",
  "--sura-border-secondary": "1px decorative divider and the unchecked switch track, whose position carries the state",
  "--sura-input-border": "resting field outline at 1.44:1; the focused field uses --sura-input-border-focus and the invalid state uses --sura-error",
  "--sura-sidebar-border": "1px divider between the sidebar and the content column",
  "--sura-scrollbar-thumb": "scrollbar part, excluded by WCAG 1.4.11",
  "--sura-scrollbar-thumb-hover": "scrollbar part, excluded by WCAG 1.4.11",
  "--sura-scrollbar-track": "scrollbar part, excluded by WCAG 1.4.11",
};

function pairRatio(theme: keyof Tokens, pair: ContractPair): number {
  const backdrop = colorOf(theme, pair.bgOver ?? "--sura-surface-primary");
  const background = colorOf(theme, pair.bg);
  const resolvedBackground = composite({ rgb: background.rgb, alpha: background.alpha * (pair.bgAlpha ?? 1) }, backdrop.rgb);
  const foreground = colorOf(theme, pair.fg);
  const resolvedForeground = composite({ rgb: foreground.rgb, alpha: foreground.alpha * (pair.fgAlpha ?? 1) }, resolvedBackground);
  return contrastRatio(resolvedForeground, resolvedBackground);
}

const THEMES: (keyof Tokens)[] = ["light", "dark"];

/**
 * Typography sizes are read through the same text-[...] utility as colours, and an undefined
 * token resolves to nothing; only a value that parses as a colour in both themes can form a
 * contrast pair. The undefined-token test below covers the undefined case.
 */
function isColorToken(token: string): boolean {
  return THEMES.every((theme) => {
    if (!TOKENS[theme].has(token)) return false;
    try {
      return parseColor(resolve(theme, token)) !== null;
    } catch {
      return false;
    }
  });
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const isSpec = (file: string) => /\.spec\.tsx?$/.test(path.basename(file));
const rel = (file: string) => path.relative(REPO_ROOT, file).split(path.sep).join("/");

/** Production surfaces only: a spec may legitimately name a token the components never use. */
function productionSources(): string[] {
  return walk(SRC_DIR).filter((file) => !isSpec(file) && !rel(file).startsWith("src/test/"));
}

const CLASS_TOKEN = /(?:[\w\-[\]().%#:]+:)*(bg|text|border|ring)-\[var\((--sura-[a-z0-9-]+)\)\](?:\/(\d+))?/g;
const LITERAL = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

function pairKey(fg: string, bg: string, fgAlpha: number, bgAlpha: number): string {
  return [fg, bg, fgAlpha, bgAlpha].join("|");
}

describe("design-token contrast contract", () => {
  it("every contract pair meets its floor in both themes", () => {
    const failures: string[] = [];
    for (const pair of CONTRACT) {
      for (const theme of THEMES) {
        const ratio = pairRatio(theme, pair);
        if (ratio < pair.floor) {
          failures.push(
            theme +
              ": " +
              pair.fg +
              " on " +
              pair.bg +
              (pair.bgAlpha ? " at " + pair.bgAlpha : "") +
              " = " +
              ratio.toFixed(2) +
              ":1, below the " +
              pair.floor +
              ":1 floor (" +
              pair.where +
              ")",
          );
        }
      }
    }
    expect(failures, "token pairs below their WCAG floor").toEqual([]);
  });

  it("the conversion reproduces the ratios axe measured in T5.1", () => {
    const errorOnHover = CONTRACT.find((pair) => pair.bg === "--sura-error-secondary");
    const toastText = CONTRACT.find((pair) => pair.bg === "--sura-error-muted");
    expect(errorOnHover).toBeDefined();
    expect(toastText).toBeDefined();
    // Measured by @axe-core/playwright on the streaming stop button and the error toast.
    expect(pairRatio("light", errorOnHover!)).toBeCloseTo(6.83, 1);
    expect(pairRatio("dark", errorOnHover!)).toBeCloseTo(6.8, 1);
    expect(pairRatio("light", toastText!)).toBeCloseTo(4.99, 1);
    expect(pairRatio("dark", toastText!)).toBeCloseTo(5.36, 1);
  });

  it("declares every text-on-background combination the components render", () => {
    const declared = new Set(
      CONTRACT.map((pair) =>
        pairKey(pair.fg, pair.bg, pair.fgAlpha ?? 1, pair.bgAlpha ?? 1),
      ),
    );
    const undocumented: string[] = [];
    for (const file of productionSources()) {
      const source = fs.readFileSync(file, "utf8");
      for (const literal of source.match(LITERAL) ?? []) {
        const found: { kind: string; token: string; alpha: number }[] = [];
        for (const match of literal.matchAll(CLASS_TOKEN)) {
          found.push({ kind: match[1], token: match[2], alpha: match[3] ? Number(match[3]) / 100 : 1 });
        }
        const colours = found.filter((entry) => isColorToken(entry.token));
        for (const foreground of colours.filter((entry) => entry.kind === "text")) {
          for (const background of colours.filter((entry) => entry.kind === "bg")) {
            if (!declared.has(pairKey(foreground.token, background.token, foreground.alpha, background.alpha))) {
              undocumented.push(
                rel(file) +
                  ": " +
                  foreground.token +
                  (foreground.alpha < 1 ? "/" + foreground.alpha : "") +
                  " on " +
                  background.token +
                  (background.alpha < 1 ? "/" + background.alpha : ""),
              );
            }
          }
        }
      }
    }
    expect(undocumented, "text/background combinations with no CONTRACT row").toEqual([]);
  });

  it("references only tokens that a token file defines", () => {
    const defined = new Set<string>();
    for (const file of tokenFiles()) {
      for (const match of fs.readFileSync(file, "utf8").matchAll(DECLARATION)) defined.add(match[1]);
    }
    const offenders: string[] = [];
    for (const file of productionSources()) {
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(/var[(]\s*(--sura-[a-z0-9-]+)/g)) {
        if (!defined.has(match[1])) offenders.push(rel(file) + " -> " + match[1]);
      }
    }
    expect(offenders, "undefined design tokens").toEqual([]);
  });

  it("gives every colour token a decided contrast role", () => {
    const contractRoles = new Set<string>();
    for (const pair of CONTRACT) {
      contractRoles.add(pair.fg);
      contractRoles.add(pair.bg);
    }
    const undecided: string[] = [];
    for (const token of TOKENS.light.keys()) {
      if (!token.startsWith("--sura-")) continue;
      if (contractRoles.has(token) || token in EXEMPT) continue;
      if (parseColor(resolve("light", token)) === null) continue;
      undecided.push(token);
    }
    expect(undecided, "colour tokens with no CONTRACT row and no EXEMPT reason").toEqual([]);
  });
});
