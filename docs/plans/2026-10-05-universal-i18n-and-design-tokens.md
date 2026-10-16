# Universal Localization & Design Token System — Updated Plan

**Date:** 2026-10-05
**Source decisions (from the planning session):**
1. **Design tokens:** full coverage — spacing, dimensions, shapes, typography.
2. **Dynamic text:** a unified `UiText` helper class for string resources, plurals, and arguments.
3. **Languages:** English and Arabic, with automated parity validation for any new language added later.

**This document updates that plan after auditing the actual repository state. Section 3 lists what the original plan missed. Section 6 records the decisions locked on 2026-10-05.**

**Status (updated 2026-10-05):** Phase 0 **DONE**, Phase 1 **DONE**, Phase 2 **DONE**, Phase 3
**DONE for the localization half** — `pnpm check:all` PASS (exit 0) on 97 test files / 997 tests,
coverage 88.50 / 81.88 / 86.35 / 92.61. **The next block of work is migrating components onto the
new `dimensions` / `shapes` tokens** (the mapping is recorded in each file's header), then the
`nested-interactive` markup fix the e2e axe test is waiting on.
Implementation progress is tracked in `docs/plans/2026-10-05-i18n-progress.md`.

**Two items are recorded but not fixed:** (a) the browser e2e gate is red at `HEAD` for reasons
unrelated to this plan — root causes in `docs/environment.md` section 12; (b) the visual smoke test
in both languages and both themes needs a human at a GUI.

**Outcome so far:** the localization half of this plan is implemented — `src/i18n/` (nested `en`/`ar`,
`UiText`, `useUiText`, parity + unit specs), a persisted `language` setting in the Dexie settings store,
`dir`/`lang`/document title driven from the active locale, and the language switcher in Settings and in
the top bar (D4). Every UI-layer string resolves through `UiText`; no component under `src/components` or
`src/features` holds an Arabic literal or a `dir` attribute, and nothing imports `@/i18n/ar` any more.
**Sections 1.1 and 1.2 below are the pre-work audit snapshot** and are kept as the record of what was
wrong. Both halves are now implemented; the deviations from this plan are listed in section 4.4 and in
`docs/plans/2026-10-05-i18n-progress.md`.

---

## 1. Where we are (evidence, not assumptions)

### 1.1 Localization — started, but only the Arabic half exists

- `src/i18n/ar.ts` — a single flat `as const` object, ~190 Arabic strings, last modified 2026-10-05.
- **24 components** import it directly: `import { ar } from "@/i18n/ar"` and consume it as `ar.send`, `ar.addModel`, … (App.tsx, ChatScreen.tsx, Composer.tsx, Sidebar.tsx, SettingsScreen.tsx, all RAG components, onboarding, keyboard, ErrorBoundary).
- **Missing entirely:**
  - No `en.ts` — there is no English resource file and no declared source of truth.
  - No `UiText` helper — no plurals, no argument interpolation, no formatting.
  - No parity validation of any kind.
  - No language switcher, no language state, no persistence (`PersistedSettings` in `src/state/settingsStore.ts` has no language field).
  - No direction management — `dir="rtl"` is hardcoded in `index.html` (`<html dir="rtl" lang="ar">`) and in **11 component spots** (App.tsx, ErrorBoundary, ChatScreen, ShortcutHelpDialog, OnboardingDialog, RagFileManager, RagFolderManager, RagIndexingProgress, RagSettings, SearchResultDisplay, SettingsScreen).
- **Hardcoded UI text still live in components** (the refactor is partial):
  - `App.tsx:58` skip link «تخطي إلى المحتوى الرئيسي», `App.tsx:87` nav toggle «إغلاق القائمة»/«القائمة».
  - `Composer.tsx:153` placeholder «سؤال مخصص لهذا النموذج (فارغ = يرث السؤال الموحد)», `Composer.tsx:158` «(فارغ = يرث الموحد)».
  - `closeLabel="إغلاق"` hardcoded in 3 dialogs (ShortcutHelpDialog, SettingsScreen, + OnboardingDialog pattern).
  - `ChatScreen.tsx:509` `aria-label="الرسائل"`.
  - `ErrorBoundary.tsx:33,44` hardcoded `dir="rtl"` / `dir="ltr"`.

### 1.2 Design tokens — comprehensive CSS, but the bridge is broken

- `src/styles/tokens/` already contains: `colors.css` (OKLCH, light + dark), `spacing.css` (8px grid + layout sizes), `typography.css` (Arabic-first stack), `radius.css`, `shadows.css`, `motion.css` (with `prefers-reduced-motion`), `index.css` facade.
- **The Tailwind bridge is broken (audit §9, `docs/2026-10-04-restructure-audit.md`):** `globals.css` `@theme inline` maps the standard shadcn names (`--color-primary`, `--color-muted-foreground`, …) to `var(--sura-*)` but **never declares `--color-sura-*`**. Tailwind 4 only generates utilities from the `--color-*` namespace, so **177 usages of 19 `sura-*` classes across dozens of files are silently inert** (`.text-sura-muted`, `.bg-sura-panel`, `.border-sura-border`, …).
- **Enabling them as-is introduces WCAG AA contrast failures in light mode** (warning/error/accent text at 2.0–3.4:1 vs the 4.5:1 threshold). The audit recommended **option B**: declare the `--color-sura-*` lines **together with** dark semantic text tokens (`--sura-warning-text`, `--sura-error-text`, `--sura-accent-text`). This decision is still pending and is now a prerequisite of the token work.
- **Missing token categories vs the decision:** no **dimensions** (icon sizes, control heights, breakpoints) and no **shapes** tokens. Radius exists; "shapes" needs a definition (see §4.2).
- **Font is referenced but never loaded:** `--sura-font-sans` names "IBM Plex Sans Arabic", but `index.html` has no font link and there is no `@font-face` — the token currently falls back to system fonts.

---

## 2. Goals (unchanged, from the decisions)

- **G1 — Full design tokens:** spacing, dimensions, shapes, typography — one source of truth for every visual value.
- **G2 — Unified `UiText` helper:** string resources + plurals + arguments + formatting, consumed through one API.
- **G3 — English + Arabic, extensible:** any new language is a new resource file; parity is validated automatically.

---

## 3. What the original plan missed (gaps found in this review)

| # | Gap | Why it matters |
|---|-----|----------------|
| 1 | **No English source-of-truth file** | Parity validation is meaningless without a reference locale. `en.ts` must be created and declared the source of truth; `ar.ts` becomes a translation of it. |
| 2 | **The broken token bridge is not in the plan** | "Full design tokens" currently means 177 inert classes. The audit §9 fix (option B + semantic text tokens) must be phase 1 of the token work, not an afterthought. |
| 3 | **No direction (RTL/LTR) strategy** | `dir="rtl"` is hardcoded in 12 places. A two-language system must drive `dir`/`lang` on `<html>` from the active locale, or English will render RTL. |
| 4 | **No language state, switcher, or persistence** | Nothing in the settings store or UI can change language. The plan needs a state owner, a persistence path, and a switcher location. |
| 5 | **Arabic plural rules are not singular/plural** | Arabic has **6 CLDR categories** (zero, one, two, few, many, other). A naive `n === 1 ? one : other` produces wrong Arabic. `UiText` needs CLDR plural rules per locale. |
| 6 | **No number/date/unit formatting strategy** | The decision says "unit formatting". Arabic `Intl` defaults to Arabic-Indic digits (٠١٢٣); the project must decide the digit strategy and own `Intl.NumberFormat`/`DateTimeFormat` centrally. |
| 7 | **Font loading is absent** | The typography token names a font that is never loaded. Tokens without the font are decorative. |
| 8 | **Resource structure undecided** | A flat ~190-key object does not scale to 2+ languages and future features. Need a decision: flat vs nested-by-feature. |
| 9 | **No migration path for the 24 existing `ar.*` consumers** | Switching the consumption API touches every screen; the plan needs an incremental migration + deprecation strategy. |
| 10 | **Parity validation mechanics undefined** | Where it lives (vitest spec vs script), when it runs (`check:all` gate), and what it checks (key sets, plural keys, argument placeholders). |
| 11 | **The "never hardcode" rule is not written down** | **Resolved 2026-10-05:** the rule now lives in `CLAUDE.md` (see 4.6), with `typecheck` + `parity.spec.ts` as the text guard. The token half still waits for the Phase 1 lint rule. |
| 12 | **Dimensions/shapes token scope undefined** | The decision names them; the plan must define what they contain before building them. |

---

## 4. Updated architecture

### 4.1 String resources (`src/i18n/`)

- **`en.ts` — source of truth.** Nested by feature for scalability:

  ```ts
  export const en = {
    app: { name: "Shura", newSession: "New session", … },
    chat: { send: "Send", stop: "Stop", … },
    rag: { settings: "Document search settings", … },
    settings: { … }, onboarding: { … }, keyboard: { … },
  } as const;
  export type ResourceKey = PathsOf<typeof en>; // dotted key type
  ```

- **`ar.ts` — translation**, same shape, values may include `{arg}` placeholders and plural forms.
- **`index.ts`** — locale registry: `{ en, ar }`, `Locale = "en" | "ar"`, `isLocale()`, and the `UiText` class (below). Adding a language = adding one file + one registry entry.
- **Type safety:** `UiText.t(key: ResourceKey, args?)` — a missing or mistyped key is a **compile error**, not a runtime fallback.

### 4.2 `UiText` helper (`src/i18n/UiText.ts`)

One class, one API, no per-component boilerplate:

- `new UiText(locale)` / `getLocale()` / `setLocale(locale)` — notifies subscribers (zustand store or `useSyncExternalStore`).
- `t(key, args?)` — string lookup + `{arg}` interpolation.
- `plural(key, n)` — CLDR plural category per locale (Arabic: zero/one/two/few/many/other; English: one/other). Resource values are objects per category.
- `format.number(value, options?)`, `format.date(value, options?)`, `format.unit(value, unit)` — thin wrappers over `Intl.NumberFormat`/`Intl.DateTimeFormat` with the active locale, so **every** formatted value in the app goes through one place.
- **Digit strategy (open question Q1):** default `ar` locale → Arabic-Indic digits via `Intl`. Recommendation: `numberingSystem: "latn"` for a tech/AI product (most Arabic tech UIs use Western digits), kept as one option in `UiText` so it is a one-line change.

### 4.3 Direction, state, persistence, switcher

- **Direction:** `UiText` (or a tiny `useLocale` hook) sets `document.documentElement.dir` and `.lang` on locale change; `index.html` ships with the default locale only. All 12 hardcoded `dir="rtl"` attributes are removed — direction comes from the locale, never from a component.
- **State + persistence:** `language: Locale` added to `PersistedSettings` (settings store, Dexie-backed — consistent with how other settings survive restarts). Default: **`ar`** (the app is Arabic-first today) — open question Q2.
- **Switcher:** a segmented control in Settings (and optionally the top bar next to the theme toggle). One obvious place beats three.

### 4.4 Design tokens (`src/styles/tokens/`) — DONE

- **Fix the bridge first (audit §9, option B):** add the eight `--color-sura-*` lines to `@theme inline` **plus** dark semantic text tokens (`--sura-warning-text`, `--sura-error-text`, `--sura-accent-text`) so the 177 existing `sura-*` utilities become live **without** light-mode contrast regressions. Verify contrast with the a11y audit skill after the change.
  **Done.** Eight `--color-sura-*` aliases added. `--sura-warning-text` and `--sura-accent-text` were
  **not** needed — measurement shows the base tokens already pass as text once their lightness is
  solved — so only `--sura-error-text` was added, plus `--sura-error-foreground` for the label on a
  solid danger fill. Contrast verified pair by pair in both themes; the axe `color-contrast`
  violation is resolved.
- **Add `dimensions.css`:** icon size scale (`--sura-icon-sm/md/lg`), control heights (`--sura-control-sm/md/lg`), breakpoints, sidebar/composer sizes (promote the layout values already in `spacing.css` into a coherent scale).
  **Done.** Icon and avatar sizes, control heights, layout widths, dialog widths and minimum widths.
  Breakpoints deliberately omitted — Tailwind's own scale is the single owner and only `sm:`/`md:`
  are used. The sidebar/composer sizes moved out of `spacing.css` so each value has one owner.
- **Add `shapes.css`:** radius aliases (component-level: `--sura-radius-button`, `--sura-radius-card`, `--sura-radius-dialog`), border widths, aspect ratios. (Scope confirmed with user — Q3.)
  **Done, with one omission.** Border widths (moved from `spacing.css`) and a z-index scale. Radius
  aliases already existed in `radii.css`. Aspect ratios omitted — nothing in the app sets one, so
  there is no value to own.
- **Load the font:** add IBM Plex Sans Arabic via `@fontsource` (bundled, offline-friendly for a Tauri app) or a `<link>` in `index.html`; wire `--sura-font-sans` to it.
  **Done.** `@fontsource/ibm-plex-sans-arabic` 5.3.0; `src/main.tsx` imports weights 400/500/600/700,
  the only ones the components use.
- **Rule:** no `px`/colors/radii in components — only token references. Enforce with an ESLint rule (no arbitrary values except documented exceptions) or at minimum a code-review checklist item.
  **Done.** `eslint.config.js` rejects raw hex literals, raw colour functions and the
  `*-white`/`*-black` utilities across `src/**/*.{ts,tsx}`. Zero violations today, so it is a
  regression guard; verified to fire on all three violation types and to stay silent on a token
  reference.

### 4.5 Parity validation (`src/i18n/parity.spec.ts`)

A vitest spec, part of `check:all`, that fails CI when:

1. **Key parity:** every non-en locale has exactly the key set of `en.ts` (no missing, no extra).
2. **Plural parity:** every plural key has all CLDR categories required by that locale.
3. **Placeholder parity:** `{arg}` placeholders in translations match the English source.
4. **Type parity:** each locale file satisfies the `en` type (compile-time via `typeof en`).

Adding `fr.ts` = adding the file + registry entry; the spec enforces the rest.

### 4.6 The "never hardcode" convention (written down)

**Written into `CLAUDE.md`** — the project instructions the agent loads on every task — so it binds
future work instead of living only in this plan. This section is the plan-side record of the same
rule. Enforcement today is `pnpm typecheck` (locale shape) plus `src/i18n/parity.spec.ts` (key,
plural and placeholder parity); the token half still relies on review until the Phase 1 lint rule
exists.

- **Text:** user-visible strings only in `src/i18n/*.ts` — never in JSX, never in aria-labels, placeholders, or `title`s.
- **Style:** visual values only as design tokens — no hardcoded colors, spacing, radii, fonts, or motion values in components.
- **One variable, one owner:** a value that appears twice is a token/resource; a value that changes per locale is `UiText`.

---

## 5. Phased implementation

### Phase 0 — Foundations (no UI change)
1. Create `en.ts` (source of truth, nested, typed) from the current `ar.ts` + hardcoded strings.
2. Implement `UiText` (locale state, `t`, `plural`, `format.*`) + `index.ts` registry.
3. Add `parity.spec.ts`; wire into `check:all`.
4. Add `language` to `PersistedSettings` + settings store; drive `dir`/`lang` on `<html>`.
5. Unit tests: interpolation, all 6 Arabic plural categories, formatting, direction switching.

### Phase 1 — Design tokens — DONE
6. Fix the Tailwind bridge (audit §9 option B) + verify contrast (a11y audit skill).
7. Add `dimensions.css` + `shapes.css`; load IBM Plex Sans Arabic.
8. ESLint rule (or documented checklist) for token-only styling.

**Next block (was not in the original phase list):** migrate components from the equivalent Tailwind
literals onto `dimensions.css` / `shapes.css` — `size-4` -> `--sura-icon-md`, `h-9` ->
`--sura-control-md`, `max-w-md` -> `--sura-dialog-width-md`, `z-50` -> `--sura-z-modal`. The
mapping table is in each file's header.

### Phase 2 — Migration
9. Migrate the 24 `ar.*` consumers to `UiText` (incremental, feature by feature: chat → sessions → settings → RAG → onboarding/keyboard).
10. Extract remaining hardcoded strings (App.tsx skip link/nav, Composer placeholder, 3× `closeLabel`, ChatScreen aria-label, ErrorBoundary dirs).
11. Remove all 12 hardcoded `dir` attributes; verify English renders LTR and Arabic RTL.

### Phase 3 — Validation
12. `pnpm check:all` green (typecheck + lint + coverage + build + parity).
13. Visual smoke test in **both** languages (screenshots, both themes) — the audit §9 contrast fix and the font change are visible changes.
14. Update `docs/environment.md` + this plan with what was built.

---

## 6. Decisions (locked 2026-10-05 — user accepted all recommendations)

- **D1 — Digits: Latin (0123).** All numbers, units, and dates render with `numberingSystem: "latn"`, even under the `ar` locale. Kept as a single option in `UiText` so it is a one-line change if that is ever revisited.
- **D2 — Default language: Arabic (`ar`).** The app stays Arabic-first; `en` is the source-of-truth resource file, not the default UI language. Persisted on first run, changeable in Settings.
- **D3 — "Shapes" scope:** component radius aliases (`--sura-radius-button`, `--sura-radius-card`, `--sura-radius-dialog`), border widths, aspect ratios, and a z-index/elevation scale. No icon-style or illustration tokens in this round.
- **D4 — Switcher location: Settings + top bar** (next to the theme toggle), so language is reachable without opening Settings.

### Resolved sub-decisions (implementation detail)

- **Resource structure:** nested by feature; `ResourceKey` is a typed dotted path into `en`.
- **State owner:** `language` lives in the persisted settings store (Dexie), not localStorage — one persistence path for all user settings.
- **Direction:** `dir`/`lang` are set on `document.documentElement` from the active locale; no component ever sets `dir` again.

---

## 7. Files affected (preview)

| Area | Files |
|---|---|
| New (done) | `src/i18n/en.ts`, `src/i18n/types.ts`, `src/i18n/UiText.ts`, `src/i18n/useUiText.ts`, `src/i18n/index.ts`, `src/i18n/parity.spec.ts`, `src/i18n/UiText.spec.ts`, `src/features/settings/LanguageSwitcher.tsx` |
| New (pending, Phase 1) | `src/styles/tokens/dimensions.css`, `src/styles/tokens/shapes.css` |
| Changed | `src/i18n/ar.ts` (re-shaped to nested), `src/state/settingsStore.ts` (+language), `src/App.tsx` + 23 components (consumption API), `src/styles/globals.css` (bridge fix), `index.html` (font + dynamic lang/dir), `package.json` (fontsource, if chosen) |
| Docs | `docs/environment.md`, this plan |
