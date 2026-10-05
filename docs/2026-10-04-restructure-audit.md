# Restructuring and Honest Audit Report — "Shura"

**Date:** 2026-10-04
**Scope:** Restructure the codebase to be clean, reusable, easy to edit, and ready to grow — plus an honest audit of every weakness, missing implementation, and feature that should be added, removed, or changed.
**Method:** Every finding is either **documented with a file and line** or **proven by an actual runnable test**. Nothing in the project was treated as untouchable.

---

## 1. Executive Summary

| Axis | Before | After |
|---|---|---|
| Largest UI component | `ChatScreen.tsx` — **1069** lines | **550** lines (−49%) |
| Largest database unit | `repos.ts` — **706** lines in one file | **728** lines across **10** modules + a facade |
| Types file | `types/index.ts` — **221** lines | **3** modules + a facade |
| `App.tsx` | **296** lines (settings dialog + duplicated SVG + inline shortcuts) | **131** lines |
| Coverage of `src/lib/rag/` | **0** tested files (16 source files) | **16** tested files / **211** tests |
| Main bundle | 1,195.17 kB | **1,071.15 kB** (128.85 kB of headroom under the 1200 budget) |
| Globally covered functions | 969/1268 = **76.42%** (below the 80 threshold ⇒ gate red) | 1105/1281 = **86.26%** (gate green) |

**Headline result:** a **real production bug that disables an entire feature** was found (§3.1), and a **second bug in text chunking** that inflates indexed sizes (§3.2). Both are proven by runnable tests.

---

## 2. What Was Restructured (an extensible structure)

### 2.1 `src/features/chat/ChatScreen.tsx` — 1069 → 550 lines
Four hooks were extracted into **637** lines, each with a single responsibility, leaving the screen purely orchestrating:

| New module | Responsibility |
|---|---|
| `hooks/useTurns.ts` | Grouping messages into turns |
| `hooks/useOperationProgressSync.ts` | Syncing operation progress on load |
| `hooks/useChatShortcuts.ts` | Ctrl+Enter to send / Escape to stop |
| `hooks/useSummaryExtraction.ts` | The whole "extract a summary" flow |

### 2.2 `src/lib/db/repos.ts` — 706 → 10 modules + a facade
Split by **semantic domain**, not by size: `operations`, `sessions`, `turns`, `identity`, `messages`, `usage`, `settings`, `clone`, `attempts`, `reconcile`, with `index.ts` as the facade. **All seven import sites work unchanged** because they go through the facade — not a single import site was edited.

### 2.3 `src/types/` — 221 → 3 modules + a facade
`providers.ts` (providers and models), `chat.ts` (conversation), `rag.ts` (semantic indexing), with `index.ts` as the facade.

### 2.4 `src/App.tsx` — 296 → 131 lines
- `src/lib/theme/useTheme.ts` — single owner of the theme key.
- `src/features/onboarding/OnboardingDialog.tsx` — the three-step handler.
- `src/features/keyboard/useAppShortcuts.ts` — global shortcuts.
- The locally duplicated `MessageSquare` was removed and imported from `lucide-react`.

### 2.5 A new protection layer
`src/components/ErrorBoundary.tsx` — the project had **no render error boundary at all**; any throw during render emptied the tree and left a white window with no way out. Errors are now logged and a reload path is shown.

---

## 3. Real Production Bugs

### 3.1 ✅ `persistence` is not indexed on `rag_documents` — the "delete temporary files" feature is completely dead (fixed)

**Evidence:**
- `src/lib/db/db.ts:71` defines schema v4:
  `rag_documents: "id, source, status, uploadedAt, sessionId, folderId"` — **no `persistence`**.
- Yet four production functions query through `.where("persistence")`:
  - `src/lib/rag/documentManager.ts:151` — `cleanupTempDocuments`
  - `src/lib/rag/documentManager.ts:165` — `cleanupTempDocumentsForSession`
  - `src/lib/rag/tempCleanup.ts:72` — `getTempDocumentCount`
  - `src/lib/rag/tempCleanup.ts:83` — `getTempDocumentSize`
- Caller: `src/features/rag/RagFileManager.tsx:55`.

**Runtime proof:** a real test ran `getTempDocumentCount()` against a real schema via `fake-indexeddb` and Dexie refused with:
`SchemaError: KeyPath persistence on object store rag_documents is not indexed`.

**Impact:** every temporary-file cleanup path after a turn/session throws at runtime. The feature exists in the code but **does not work at all**.

**Proposed fix:** add `persistence` to the `rag_documents` index list — either in the `version(4)` definition itself (cleanest, since v4 was never released) or in a new `version(5)` if a local development database already exists at v4. Adding an index deletes no data: Dexie builds it from existing rows.

**Important scope note (report honesty):** the entire RAG feature — `src/lib/rag/*` including the modified `db.ts` — **was still uncommitted in Git** (untracked files in the working tree). So schema v4 **has not shipped to any user**. The bug is real and confirmed, but its impact on current users is zero; it must be fixed **before** the first release that carries RAG, not after. This does not diminish it: committed as-is, it would have shipped a dead feature.

**✅ Fixed in this round:**
- `src/lib/db/db.ts`: added the `rag_model_blobs` table and a `version(5)` carrying
  `rag_documents: "id, source, status, uploadedAt, sessionId, folderId, persistence"`.
  `version(4)` was kept verbatim so an existing v4 development database migrates instead of being rejected.
- `src/lib/rag/tempCleanup.spec.ts`: the five tests that were **asserting the bug** (expecting `SchemaError`)
  were replaced with real cleanup tests: temporary deleted alone, permanent kept, and both counters correct (2 / 350). The file is now 10 tests.
- `src/lib/rag/documentManager.spec.ts`: two blocks replace the bug-asserting with actual behavior (`cleanupTempDocuments`
  and `cleanupTempDocumentsForSession`). The file is now 22 tests.
- `src/lib/db/migration.spec.ts`: a v4→v5 migration test proving a RAG document survives the upgrade and is queryable through the new index.
- `src/lib/db/schema.spec.ts` (new): a regression guard that actually reads the production code, extracts every
  `db.<table>.where("<field>")` (25 queries / 16 pairs across 9 files), and asserts each field is indexed in its table.
  This test would have caught §3.1 before release.

Verification: `pnpm exec vitest run src/lib/rag/tempCleanup.spec.ts src/lib/rag/documentManager.spec.ts` ⇒ 32/32 passing.

### 3.2 🔴 Text chunking: `overlap = 0` inflates sizes instead of removing overlap

**Evidence:** `src/lib/rag/chunker.ts`
- Line 86: `splitWords(wordChunk).slice(-Math.ceil(overlap / 4))`
- Line 103: `splitSentences(currentChunk).slice(-Math.ceil(overlap / 100))`

At `overlap = 0` (a legitimate value meaning "no overlap"): `Math.ceil(0/4) = 0`, and `slice(-0)` === `slice(0)`, i.e. **copying the entire array**. The result: the next chunk starts with the whole previous chunk and exceeds `chunkSize` many times over.

**Runtime proof:** a test chunked 40 sentences with `{ chunkSize: 40, overlap: 0 }` and produced **a single chunk containing all 40 sentences**.

**Accessibility:** not theoretical — the "chunk overlap" slider in `src/features/rag/RagSettings.tsx:138-146` is defined with `min={0}`, so the far-left position of the slider (the first thing a user reaches for when looking for "no overlap") is what triggers the bug.

**Impact:** indexing long texts with no overlap stores them as one giant chunk — destroying semantic retrieval accuracy and multiplying embedding consumption.

**✅ Fixed in this round** (`src/lib/rag/chunker.ts:86-89` and `:103-105`):

    const overlapWords = overlap > 0 ? splitWords(wordChunk).slice(-Math.ceil(overlap / 4)) : [];
    wordChunk = overlapWords.length > 0 ? overlapWords.join(" ") + " " + word : word;
    // ...
    const overlapSentences = overlap > 0 ? splitSentences(currentChunk).slice(-Math.ceil(overlap / 100)) : [];

The two tests in `src/lib/rag/chunker.spec.ts` that were asserting the broken behavior were turned into two regression
tests checking that overlap is absent and `chunkSize` is not exceeded. Result: 13/13 passing, tsc/eslint clean.

### 3.3 ✅ The embedding-model cache stores no bytes — re-downloading 480 MB every session (fixed)

**Evidence:** `src/lib/rag/embedder.ts`
- `saveModelFromCache` (286-303) writes a row to `rag_models` **with metadata only** (no model bytes).
- `loadModelFromCache` (270-280) **always returns `null`** even when the row exists, with an explicit comment: "In a real implementation, we'd store the model bytes in IndexedDB. For now, return null to trigger download".

**Impact:** the cache is write-only ⇒ every embedding session **re-downloads the model from HuggingFace**. The default declared size is `sizeBytes: 480_000_000` (480 MB). This is a severe performance weakness, not merely dead code.

**✅ Fixed in this round:**
- A new `rag_model_blobs: "id"` table holds the bytes, separate from the metadata row in `rag_models`
  so the "is the model downloaded?" query does not pull hundreds of megabytes.
- `embedder.ts`: `loadModelFromCache` reads `db.rag_model_blobs.get(modelId)?.bytes ?? null`,
  and `saveModelToCache` writes the metadata row and the bytes in a single `db.transaction("rw", …)`.
- `modelDownloader.ts`: `downloadModel` stores the bytes it already holds (it used to discard them and only set the flag),
  and `deleteModel` deletes the bytes along with the row.
- Two new regression tests in `embedder.spec.ts`: (a) an already-downloaded model is not re-downloaded after the in-memory
  cache is cleared — exactly the behavior that was broken; (b) a metadata row without bytes (incomplete cache) re-downloads instead of failing.
- Two tests in `modelDownloader.spec.ts`: bytes are stored in the separate table, and `deleteModel` wipes them.

Verification: `pnpm exec vitest run src/lib/rag/embedder.spec.ts src/lib/rag/modelDownloader.spec.ts src/lib/rag/reindexManager.spec.ts` ⇒ 33/33 passing.

---

## 4. Code Smells Fixed in This Round

| # | Location | Problem | Fix |
|---|---|---|---|
| 1 | `src/lib/transport/transport.ts:18` | A production module exports `testProviderKey` (a test utility) — added only to satisfy a literal import path in a test | Export removed; the test imports the utility from its home `@/lib/providers/keyTest` |
| 2 | `src/lib/logging.ts:58` | `loadMetrics()` at import time — a side effect from merely importing the module | Lazy load on first use via `ensureMetricsLoaded()` |
| 3 | `src/lib/logging.ts:179` | `initAppLogging()` is not idempotent — every call registers new listeners | `loggingInitialized` guard |
| 4 | `src/main.tsx:99-106` | Duplicate `error`/`unhandledrejection` listeners (also present in `logging.ts)) ⇒ every unhandled error logged twice | Single early registration via `initAppLogging()` before the first render |
| 5 | `src/main.tsx` | Two separate imports from `@/lib/db/repos` + a broken initialization offset | Imports merged and the offset fixed |
| 6 | `src/App.tsx:279-296` | A local `MessageSquare` SVG duplicating `lucide-react` | Imported from `lucide-react` |
| 7 | `package.json` | `pnpm.onlyBuiltDependencies` is ignored by pnpm 11 ⇒ a warning on **every** command | Moved to `pnpm-workspace.yaml` (the warning actually disappeared) |
| 8 | — | No `engines` and no `.nvmrc` | Both added (Node ≥22.12.0 — the Vite 8 floor; pnpm ≥11) |
| 9 | Repository root | Junk files: `search-ai.cjs`, `test-output.txt`, `LOGGING_SUMMARY.md` + a duplicate `agent/` from `.agents/` | Deleted; `agent/` added to `.gitignore` |

---

## 5. Dead / Unreachable Code (recommended for removal or documentation)

| Location | Note |
|---|---|
| `chunker.ts:104` | ~~The wrong `overlapSentences.length === 0` branch is unreachable~~ — **gone with the §3.2 fix**: the branch now actually executes at `overlap = 0` |
| `modelDownloader.ts` | ~~The fallback in `getModelUrl`~~ — **gone**: the triplicated catalog and both URL maps were removed and replaced by `src/lib/rag/modelCatalog.ts` |
| `embedder.ts` | ~~The `if (modelData)` branch is dead~~ — **gone with the §3.3 fix**: the cache actually reads now, so the branch executes |
| `embedder.ts` | ~~The unreachable `Embedder not initialized` throw~~ — **gone**: session and tokenizer live in a single `loaded` field and `ensureLoaded()` returns a non-nullable type, so the two checks and the non-null assertions at every site fell away |
| `logging.ts` | ~~`getLogBuffer` has no consumer~~ — **gone**: `src/features/settings/LogViewer.tsx` renders it in dev mode (§6.1) |
| `logging.ts` | ~~`incrementMessageCount` is never called~~ — **gone**: called in `ChatScreen.tsx` on every new turn (§6.2) |
| `logging.ts` | `resetMetrics` is still exported with no production consumer (called only in tests). **Left intentionally**: a small diagnostic API, and deleting it adds no value |

---

## 6. Feature Recommendations

### To add — ✅ all three implemented
1. ✅ **A dev log viewer** — `src/features/settings/LogViewer.tsx`: turn metrics (sessions/messages/errors/uptime)
   + the last 100 entries from `getLogBuffer` with level filtering and a one-second auto-refresh. Shown only in `import.meta.env.DEV`
   and not added to the production settings section index. 7 tests in `LogViewer.spec.tsx`, with the log source injectable so the view
   can be tested without touching the module's global state.
2. ✅ **A message counter** — `incrementMessageCount()` is called in `ChatScreen.tsx` inside `persistTurn` on every new turn
   (a retry adds no user message, so it is not counted twice).
3. ✅ **A schema regression test** — `src/lib/db/schema.spec.ts` (§3.1).

### To remove — ✅ implemented
4. ✅ The dead `getModelUrl` fallback was removed, along with the triplicated catalog and both URL maps: all of it is now
   `src/lib/rag/modelCatalog.ts`. And `getModelUrl` now **throws** for an unknown model instead of silently falling back to the
   default — the silent fallback downloaded a different model and labelled it with the requested model's name.
5. ✅ The dead `if (modelData)` branch is gone with the real cache implementation (§3.3).

### To change
6. `chatController.ts` (**718** lines) — the largest remaining production unit. **An honest note:** it is a single `sendTurn` function with a large closure, not a multi-responsibility module; the complexity is intrinsic to the parallel dispatch, cancellation, and resilience logic. A safe split is possible for "signal wiring" and "streaming save points" but requires a shared context object — **deliberately not implemented** because the risk to the critical dispatch path is not worth a cosmetic benefit.

---

## 7. Verification Numbers

| Check | Result |
|---|---|
| `pnpm exec tsc --noEmit` | **PASS** (clean) |
| `pnpm lint` | **PASS** (clean — 3 pre-existing errors in `e2e/fixtures.ts` fixed) |
| `pnpm build` | **PASS** — main bundle **1,071.15 kB** (gzip 306.08 kB) |
| `pnpm exec vitest run src/lib/rag` | **PASS** — 16 files / 211 tests |
| `src/lib/rag` coverage | 96.59% statements · 89.95% branches · 97.87% functions · 97.37% lines |
| Full chain `pnpm check:all` | **PASS in full (exit 0)** — typecheck + lint + coverage + build |
| Final global coverage | **4314/4884 = 88.32%** statements · **2969/3632 = 81.74%** branches · **1105/1281 = 86.26%** functions · **3698/3998 = 92.49%** lines (threshold 80/75/80/80) |
| Test suite | **957/957 across 94 files** |

### 7.1 The function-coverage campaign — 22 new test files

The gate was red on **functions** specifically: 969/1268 = **76.42%** against an 80% threshold (i.e. 46 functions short). The gap was closed with **22 new test files / 151 tests**, **without touching any production code** and without any new dependency:

| Scope | New files | Tests | Functions covered |
|---|---|---|---|
| `src/components/ui/**` | 10 | 41 | 42 (was 0%) |
| The four RAG components | 4 | 45 | 44 (was 0%) |
| Logging, hooks, and theme | 8 | 65 | 36 |
| **Total** | **22** | **151** | **122** |

Final result after the fix round: **1105/1281 = 86.26%** — a margin of ~6 points above the threshold, not a bare pass.

Added on top of that are **16 test files / 211 tests** for the `src/lib/rag` library (which had zero tested files), then **2 test files / 9 tests** in the fix round (`schema.spec.ts` the schema guard, and `LogViewer.spec.tsx`), and **5 tests** added to existing files (`embedder.spec.ts`, `modelDownloader.spec.ts`, and `migration.spec.ts`). The repository is now **94 files / 957 tests**.

---

## 8. Conscious Decisions

- **`repos.ts` was deleted** as a single file and redistributed across 10 modules — under explicit consent within the restructuring request. The content is fully preserved and the data-layer tests are green.
- **`chatController.ts` was not touched** (§6.6) — risk to a critical path with no cosmetic benefit.
- **The §3.1 error was fixed with an explicit schema upgrade** (`version(5)`) after the user asked to fix everything in the report. The upgrade migrates an existing v4 database instead of rejecting it, and adding an index deletes no rows (Dexie builds it from what exists), with a migration test proving it.
- **The §3.2 error was fixed** because it is pure logic with no bearing on stored data, and its impact is confirmed and reachable from the UI.
- **All new tests use Arabic names** and follow the existing `fake-indexeddb` pools.

---

## 9. A New Error Discovered While Implementing the Fixes — the `sura-` Tailwind tokens are undeclared, so 177 usages have no effect

Discovered while building the log viewer (§6.1) and trying to follow the project's prevailing styling convention.

**Evidence:**
- `src/styles/globals.css:8-44` declares `@theme inline` and assigns only the standard shadcn names:
  `--color-primary`, `--color-muted-foreground`, `--color-border`, `--color-destructive`… and declares **no `--color-sura-*`**.
- The design tokens themselves are sound and live in `src/styles/tokens/colors.css` as plain CSS custom properties
  (`--sura-text-secondary`, `--sura-warning`…), but Tailwind 4 generates utilities from the `--color-*` namespace alone.
- Measured against the actual build output `dist/assets/index-*.css`: none of `.text-sura-muted`,
  `.bg-sura-panel`, `.text-sura-warn`, `.border-sura-border`… exist **at all**, while `.text-muted-foreground`,
  `.bg-popover`, and `.focus:bg-accent` are genuinely present — so the mechanism works, and what is missing is the declaration.

**Scale:** **177 usages** of **19 classes** across dozens of files, the worst offenders being:

| Class | Usages | Files |
|---|---|---|
| `text-sura-muted` | 64 | 19 |
| `border-sura-border` | 37 | 13 |
| `text-sura-warn` | 11 | 7 |
| `text-sura-danger` | 11 | 6 |
| `bg-sura-bg` | 9 | 4 |
| `text-sura-accent` | 6 | 6 |
| `bg-sura-accent` | 6 | 5 |
| `bg-sura-panel` | 4 | 4 |
| The rest (11 classes, incl. `text-sura-foreground`, `bg-sura-border`, `border-sura-accent`) | 29 | — |

**Impact:** "muted" text is not muted, borders are not colored, `text-sura-warn` warnings and
`text-sura-danger` errors render in the plain text color, and `bg-sura-panel` backgrounds are not applied. The UI works because the
standard alternatives (`text-muted-foreground`…) are used in other places, but 177 design intents are silently dropped.

**Why it was not fixed immediately — this is a decision that needs your input:** the one-line fix is easy (eight `--color-sura-*` lines in
`@theme inline`), but it **introduces WCAG AA contrast failures in light mode**, because the semantic tokens are tuned for use as
backgrounds rather than as text:

| Token | Its value (light) | Estimated contrast on `--sura-surface-primary` | AA threshold for normal text |
|---|---|---|---|
| `--sura-text-secondary` (for `sura-muted`) | L=0.45 | ~5.0:1 ✅ | 4.5:1 |
| `--sura-accent-primary` (for `sura-accent`) | L=0.55 | ~3.4:1 ❌ | 4.5:1 |
| `--sura-error` (for `sura-danger`) | L=0.55 | ~3.4:1 ❌ | 4.5:1 |
| `--sura-warning` (for `sura-warn`) | L=0.70 | ~2.0:1 ❌ | 4.5:1 |

Today these classes are inert, so the text inherits `--sura-text-primary` (contrast ~13:1) — meaning the current bug
"protects" contrast by accident. Enabling the tokens as they are would push warning and error text below the threshold.

**Options:**
- **A.** Add the eight `--color-sura-*` lines as they are — the smallest change, but it introduces contrast failures in light mode.
- **B.** Add the lines **together with** dark semantic text tokens (`--sura-warning-text`, `--sura-error-text`, `--sura-accent-text`)
  assigned to `sura-warn`, `sura-danger`, and `sura-accent`, leaving the backgrounds at their current values.
- **C.** Gradually delete the 177 classes and replace them with their working standard equivalents (`text-muted-foreground`…) —
  cleanest long-term, but the most expensive and most scattered.

**Recommendation: B.** It resolves the error without breaking contrast, and keeps the change in a single file. But it is a visible design
change across every screen, and I cannot verify it visually from here — so it was **not implemented** in this commit and was kept
separate from it.
