# Manual accessibility pass - M5 / T5.3

**Status:** checklist READY, pass NOT RUN. T5.3 Step 2 is a human gate and is currently **BLOCKED**; nothing in this file is a result unless the line says "measured".
**Build under test:** `__` - copy the entry hash from `dist/assets/index-*.js` (web) or the installer version (desktop).
**Ran by / date:** `__`
**Machine, Windows build, assistive technology and zoom used:** `__`

## 1. Why this file exists

The automated half of M5 is repeatable and green (section 9). A machine can measure ratios, landmarks and geometry, but it cannot judge whether an announcement is *understandable*, whether the keyboard order matches the reading order in Arabic, whether text scaling keeps a screen usable, or whether switching language changes the announced voice. This is the script for that pass.

Record every line with **PASS**, **FAIL** or **N/A** plus one clause of evidence. A FAIL must name the screen, the expected behaviour and the actual one. Every FAIL becomes a task in `TASKS.md` under M5 (`- [ ] **T5.3-fN ...**`) and is fixed before release (T5.3 Step 3).

## 2. Preconditions

- Build first: `pnpm build` (web) or run the NSIS installer from `src-tauri/target/release/bundle/nsis/` (desktop). The browser suites serve `dist/`, so an unbuilt source tree is not under test.
- Fresh state for the first-run screens: DevTools -> Application -> Clear site data. The onboarding flag is `shura-onboarding-seen` and the theme preference is `shura-theme` in `localStorage`; the app boots dark unless `shura-theme` is `light`.
- Run each section once dark and once light, and each section in Arabic first and then in English through the top-bar language switcher.
- Keep the console open: a React or Radix warning is a finding even when the screen looks right.

## 3. Keyboard-only journey (WCAG 2.1.1, 2.1.2, 2.4.3, 2.4.7, 2.4.11)

| # | Check | Result |
|---|-------|--------|
| K1 | From a fresh load, the first Tab stop is the skip link "تخطي إلى المحتوى الرئيسي" and it is visible while focused. | |
| K2 | Enter on the skip link moves focus into the main content; the next Tab does not walk back through the top bar. | |
| K3 | Every stop paints a visible focus ring. `e2e/focus.spec.ts` covers the first eight stops in both themes; here walk the whole app: top bar, sidebar rows, composer, model chip, result cards, dialogs, toasts. | |
| K4 | Tab order follows RTL reading order (right to left, top to bottom) on the chat screen and inside the settings dialog; in English it follows LTR. | |
| K5 | Shortcuts work with focus in the composer and outside it: Ctrl+K focuses the session search, Ctrl+N creates a session, Ctrl+, and Ctrl+Shift+S open settings, Ctrl+/ toggles the theme, ? opens help (not while typing), Escape stops a running turn. | |
| K6 | Escape closes the settings dialog, the shortcut dialog and the mobile navigation, and focus returns to the control that opened it. | |
| K7 | The settings search filters the table of contents and the remaining links stay in the tab order. | |
| K8 | Activating a table-of-contents link scrolls to its section: note whether focus follows the scroll and whether the new position is announced (the link target is `#section-*`, so this is a check, not an assumption). | |
| K9 | No keyboard trap: Tab cycles inside the settings and onboarding dialogs and Escape always exits. | |
| K10 | A session row is fully operable: open by Enter, rename (Enter to commit, Escape to cancel) and delete (native confirm) without a mouse. | |
| K11 | The model picker ("إضافة نموذج") can be completed with the keyboard alone: open, choose a provider, choose a model, confirm. | |

## 4. Screen-reader script (Narrator or NVDA)

| # | Check | Result |
|---|-------|--------|
| S1 | First load announces a language/direction, the app heading "شورى", the empty-state heading "ابدأ محادثة جديدة" and the create-session button with a name. | |
| S2 | The landmark list names the regions: the top bar (`header`), the sessions sidebar (`aside`), the main region and the settings table of contents (`nav` with a label). | |
| S3 | Send a prompt: a polite live region announces progress, each card is a status region that is `aria-busy` while streaming and stops being busy when it finishes, and the answer reads in order. | |
| S4 | Card metadata (model name, token usage, latency, cost) is announced with labels rather than as loose numbers. | |
| S5 | An invalid primary model is announced as an alert; a failed request announces its error text in the interface language, not as a raw provider string. | |
| S6 | The settings dialog is announced as a dialog named "الإعدادات", its close button is named, and each collapsible section announces expanded/collapsed. | |
| S7 | Switching to English changes the announced voice/dictionary (checks `lang` on `<html>`) and the layout mirrors (checks `dir`). | |
| S8 | The provider key field, the timeout field and the settings search are announced with their labels, not only as "edit". | |
| S9 | A toast is announced exactly once. | |

## 5. Text scaling and reflow (WCAG 1.4.4, 1.4.10)

| # | Check | Result |
|---|-------|--------|
| Z1 | 200% zoom (Ctrl+Plus three times in a 1280px window = 640 CSS px): no clipping, no overlap, no horizontal page scrolling. | |
| Z2 | 320px width (400% zoom) on the chat screen, the sidebar overlay, the settings dialog and the shortcut dialog: no two-dimensional scrolling. **Measured 2026-10-12:** the document and both dialogs stay at `scrollWidth == viewport` after the T5.3-f1 fix, and `e2e/reflow.spec.ts` now guards this permanently - re-check by hand anyway. | |
| Z3 | Browser text-only size increase (Chrome: Settings -> Appearance -> Font size = Very large; Firefox: zoom text only) does not clip labels or controls. | |
| Z4 | Long content survives: a very long session title, a long model name and a long unbroken URL in a prompt wrap or scroll inside their own box instead of widening the page. | |
| Z5 | The composer grows to its maximum height and then scrolls internally, with the send button still reachable. | |

## 6. Reduced motion (WCAG 2.3.3)

| # | Check | Result |
|---|-------|--------|
| R1 | With Windows animation effects off (or DevTools -> Rendering -> `prefers-reduced-motion: reduce`), streaming, toasts, the settings dialog and the mobile navigation appear without animation (the duration tokens collapse to 0.01ms). | |
| R2 | Nothing depends on animation to be understood: a streaming card still shows its busy state in text and ARIA. | |
| R3 | Focus changes and status announcements are still perceivable with animation off. | |

## 7. Arabic RTL and English LTR

| # | Check | Result |
|---|-------|--------|
| D1 | `dir` and `lang` on `<html>` follow the active language on every screen and after a reload. | |
| D2 | Logical direction holds: in Arabic the sidebar border and the start-aligned controls mirror to the other side in English. | |
| D3 | Mixed content (a Latin model id, a Windows path, an English error snippet inside Arabic text) keeps its own direction without breaking the sentence, and vice versa in English. | |
| D4 | Numbers, dates and units follow the locale. | |
| D5 | The theme survives a reload and a language switch. | |
| D6 | Visual smoke test carried over from the i18n plan (`docs/plans/2026-10-05-i18n-progress.md`): both languages x both themes across the chat screen, sidebar, settings dialog and shortcut help - no untranslated string, no clipped layout, no wrong-direction element, and a theme switch leaves both locales readable. | |

## 8. Sign-off

| Section | Lines | Result | Note |
|---------|-------|--------|------|
| 3 Keyboard | K1-K11 | | |
| 4 Screen reader | S1-S9 | | |
| 5 Scaling and reflow | Z1-Z5 | | |
| 6 Reduced motion | R1-R3 | | |
| 7 RTL and LTR | D1-D6 | | |

M5's exit criterion is this table: every line PASS, or a recorded task with the failure and its fix.

## 9. Automated baseline (green, do not repeat by hand)

| Suite | What it proves | Last measured |
|-------|----------------|---------------|
| `e2e/axe.spec.ts` (8 tests) | no serious or critical axe violation in eight states, both themes | 2026-10-12 PASS |
| `src/styles/tokens/contrast.spec.ts` (5 tests) | 47 token pairs meet 4.5:1 (text) and 3:1 (indicators) in both themes, plus a definition and completeness guard | 2026-10-12 PASS |
| `e2e/focus.spec.ts` (2 tests) | every `:focus-visible` element paints a solid outline of at least 2px | 2026-10-12 PASS |
| `e2e/reflow.spec.ts` (2 tests) | the transcript and both dialogs reflow to 320px without horizontal scrolling | 2026-10-12 PASS |

## 10. Findings recorded while writing this checklist

- **T5.3-f1 (MEDIUM, WCAG 1.4.10 Reflow) - FIXED 2026-10-12.** At a 320px viewport the settings dialog held 406px of content in a 318px client box and scrolled sideways: 19 interactive controls, including both mode switches, sat outside the viewport until the dialog was scrolled horizontally. The cause was one row - the primary-model provider/model selects, whose two native selects cannot shrink below their widest option and whose combined min-content is 358px - and hiding that row dropped the dialog to 318px. Fixed by letting that row wrap (`flex-wrap` in `src/features/settings/SettingsScreen.tsx`), which changes nothing above ~420px. Guard: `e2e/reflow.spec.ts`, RED 1 failed / 1 passed -> GREEN 2 passed.
- **T5.3-f2 (LOW, best practice) - FIXED 2026-10-12.** The first-run screen exposed no `main` landmark: `<main>` existed only inside `ChatScreen.tsx` (lines 240 and 248, both `tabIndex={-1}` for the dialog focus handoff), while the empty state rendered inside `div#main-content` - the skip link's target, but a plain `div` that is never a landmark. Axe does not report it because `landmark-one-main` is a best-practice rule and the automated matrix fails on serious and critical violations only, so this is the same blind spot that hid the focus indicator in T5.2. Fixed by rendering the empty state's block as `<main>` in `src/App.tsx`; the two branches are exclusive, so two `main` landmarks never coexist (and the new assertion would fail if they did, because a role query rejects an ambiguous match). Guarded by a unit assertion in `src/App.smoke.spec.tsx`: RED "Unable to find an accessible element with the role \"main\"" -> GREEN 2 passed. Not covered by axe, which is why the guard is a unit test.
- **Q9 (visual, open).** The per-component focus ring recipe compiles to a ring *colour* because Tailwind resolves the ambiguous `var()`, so no ring ever rendered; the restored global outline is the only indicator. Whether to make the ring work (ring and outline would then both paint) or delete the dead recipe is a visual decision recorded in `TASKS.md`.
