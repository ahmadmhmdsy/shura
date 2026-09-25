# Shura - dogfood report

**Date:** 2026-09-25
**Build:** branch shura/hardening at 7644c2d
**Target:** Chromium 154 via CDP against the Vite dev server at http://127.0.0.1:5173/
**Verdict:** the flows exercised below work. Two defects were found and fixed during this pass.

## How this was tested

Unit and integration checks (502 tests, 44 files) plus a real browser session against the
running dev server. Every command below was actually executed; no result is inferred.
No provider key, paid request, deployment, or external account was used.

## Verified in the browser

| # | Flow | Result |
|---|---|---|
| 1 | App boots and renders the shell | PASS - heading, New Session, Settings, labelled search field, main region |
| 2 | New Session no longer blanks the app | PASS - a session row and the full composer appear (13100 characters of DOM) |
| 3 | Composer controls are present and labelled | PASS - Add model, shared-question switch, context switch, prompt box, summary, send |
| 4 | Settings opens as a real dialog | PASS - dialog role, titled, four provider cards, provider/model selects, folder, timeout |
| 5 | Escape closes Settings | PASS - dialog removed from the DOM |
| 6 | Focus returns to the opener after Escape | PASS after the fix - the active element is the Settings button |
| 7 | No horizontal overflow at 390px | PASS - scrollWidth 390 equals innerWidth 390 |
| 8 | Mobile menu toggle appears below md | PASS - the menu button with aria-expanded false |
| 9 | Drawer opens, then closes with Escape | PASS - aria-expanded false, true, false; the label switches to the close label |
| 10 | Enter on a focused session row opens it | PASS - main switches from the placeholder to the composer |
| 11 | Console and page errors during the pass | PASS - none reported |

## Defects found and fixed in this pass

### 1. Focus was not restored when Settings closed (WCAG 2.4.3)

Escape closed the dialog but left focus on document.body, so a keyboard user lost their place.
The opener was captured in a mount effect, by which point Radix had already moved focus into
the dialog, so the wrong element was being restored. Fixed by capturing the opener during
render instead. This passed the jsdom test and failed only in the real browser - only
browser QA exposed it.

### 2. The dialog close button was labelled Close in an Arabic application

DialogContent hard-coded the English screen-reader label. Added a closeLabel prop,
defaulting to the Arabic word, so the shipped language stays consistent.

## Verified only by automated tests, not in the browser

- Credential encryption and the Tauri keychain path: exercised by unit tests and cargo test;
  the desktop build was not launched in this session.
- Archive atomicity, quarantine, and durable deletion: exercised against an in-memory sink.
- Cost and pricing arithmetic: unit tests only.

## Still open

- Contrast (WCAG 1.4.3) is unverified. No visual audit was performed; the theme is applied
  and the palette is unchanged, but no contrast ratio has been measured.
- The response-size cap is not enforced. It belongs to the frozen dispatcher and is still a
  known gap, not a shipped guarantee.
- No end-to-end send was performed, because that would require a real provider key and a
  paid request. The dispatch path is covered by tests with a mocked provider only.
