# Shura Production-Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Update `2026-10-05-production-readiness-progress.md` (the memory file) after every task.

**Goal:** Fix every finding in `docs/reviews/2026-10-05-shura-current-state-review.md` and close the validation, accessibility, packaging and honesty gaps so that Shura can be shipped as a production release whose claims reproduce.

**Architecture:** No architectural rewrite. Two surgical changes carry most of the risk: (1) the RAG embedding pipeline gains a real tokenizer plus an embedding-identity version so a stored vector can never be compared against a vector from a different tokenizer, and (2) the desktop CSP/asset policy changes from "CDN by default" to "everything the app executes is bundled locally", with a contract test that fails if a CDN URL is reintroduced. Everything else is correctness, i18n, accessibility and gate work in place.

**Tech Stack:** React 19, Vite 8 (Rolldown), TS 5.9, Tauri 2, Zustand 5, Dexie 4, `ai` 7, `onnxruntime-web` 1.30, `hnswlib-wasm`, `pdfjs-dist` 6.3, `mammoth`, Radix, Tailwind 4, Vitest 5, Playwright 1.63, pnpm 11 / Node 24.

---

## 0. Source, scope and reading order

- **Source review:** `docs/reviews/2026-10-05-shura-current-state-review.md` (sections cited below as `n).
- **Memory file (update every session):** `docs/plans/2026-10-05-production-readiness-progress.md`.
- **Task board:** `TASKS.md` (repo root).
- **This plan is executed task-by-task**, each task ending in a green `pnpm check:all` (or a documented narrower command) and an updated ledger row.

### Finding to task map

| Finding | Severity | Blocks release? | Milestone / task |
|---|---|---|---|
| NH-01 tokenizer is a placeholder; embeddings meaningless and not comparable across restarts | HIGH | **YES** | M1 / T1.1, T1.2 |
| NH-02 production CSP blocks WebAssembly and every RAG asset | HIGH | **YES** | M1 / T1.3 |
| NM-01 `search_documents` registered but its result is unreachable at one step | MEDIUM | no | M2 / T2.1 |
| NM-02 a stream that ends without a finish reason is reported as done | MEDIUM | no | M2 / T2.2 |
| NM-03 cost computed from the static registry stub | MEDIUM | no | M2 / T2.3 |
| NM-04 library-layer hardcoded Arabic; no lint enforcement for it | MEDIUM | no | M3 / T3.1-T3.3 |
| NM-05 the tool advertises `scope` and ignores it | MEDIUM | no | M1 / T1.4 |
| NM-06 audit is not clean; docs claim zero vulnerabilities | MEDIUM | no | M0 / T0.1 |
| NM-07 the bundle budget is not a gate and the recorded figures are stale | MEDIUM | no | M0 / T0.2, T0.3 |
| NL-01 cache-write tokens dropped from cost | LOW | no | M2 / T2.4 |
| NL-02 the context meter and the context gate disagree | LOW | no | M2 / T2.5 |
| NL-03 the key test spends a second call re-proving a deterministic failure | LOW | no | M2 / T2.6 |
| NL-04 the tool delimiter interpolates an unescaped file name | LOW | no | M1 / T1.5 |
| NL-05 two writers for the model-cache tables | LOW | no | M1 / T1.6 |
| NL-06 ineffective dynamic import; an unused 28 MB wasm is shipped | LOW | no | M1 / T1.3 |
| LV-01 session header required by OpenCode Go | GOOD | no | verified - app already sends it (review section 13) |
| LV-02 reasoning models emit nothing visible while reasoning | MEDIUM | no | M2 / T2.7 |
| LV-03 OpenCode Go pricing is unsourced and rendered as money | HIGH | yes (honesty) | M2 / T2.9, M3 / T3.4 |
| LV-04 only 5 of 38 entitled models reachable; anonymous catalog leaks 7 | MEDIUM | no | M2 / T2.8 |
| LV-05 all five static OpenCode Go ids still exist | GOOD | no | verified (review section 13) |
| LV-06 two supplied free-model names do not exist | info | no | T6.7 Step 1 corrected |
| LV-07 cost string bypasses `UiText` and number formatting | LOW | no | M3 / T3.4 |
| LV-08 usage/SSE/bad-key behaviour matches what the app expects | GOOD | no | verified (review section 13) |
| LV-09 the split RAG chunks are modulepreloaded, so the eager payload is 1,309,757 bytes against a 1,200,000-byte entry budget | MEDIUM | no | M1 / T1.3 Step 9 |
| Manual a11y, desktop E2E, MSI, cross-platform | gaps | **YES to ship** | M5, M6 |

### Definition of "production ready" (the release gate)

A build may ship only when all of the following hold, each with recorded output:

1. `pnpm check:all` PASS (now including the audit and bundle gates added in M0).
2. `pnpm test:e2e:browser` PASS, and `pnpm test:e2e:tauri` PASS (T6.1) or recorded SKIPPED with a documented human substitute.
3. Desktop smoke on a real window covering first run, a real provider turn, and a document upload that reaches a search result (T6.2).
4. `docs/environment.md`, `README.md` and `CHANGELOG.md` numbers are generated from, or verified against, the exact build being shipped (M0/T0.3, M7/T7.2).
5. Advisories: zero moderate-or-worse in the production graph, or each one present in the accepted-risk register (M0/T0.1).
6. `docs/release-checklist.md` (T6.8) fully ticked.
7. No provider displays an unsourced price: every OpenCode Go rate is either attributed to a published source or unknown (LV-03/T2.9).

### Non-goals (explicit)

- No new UI features, no new providers, no backend service.
- No migration away from Dexie, Zustand, Tailwind or the `ai` SDK.
- No macOS/Linux packaging claim until T6.4 is green; Windows NSIS is the primary artifact.
- Auto-update, telemetry, accounts and sync are out of scope.

---

## 1. Locked decisions

| # | Decision | Choice | Why | Status |
|---|---|---|---|---|
| D1 | Tokenizer for embedding models | Add `@huggingface/transformers` (4.3.1) and use `AutoTokenizer`, lazily imported inside the existing `rag-embedder` chunk; fall back to `@huggingface/tokenizers` (0.2.0) if the measured chunk delta breaches the M0 budget | The models are `Xenova/*` HF repos; each ships `tokenizer.json` next to `onnx/model_quantized.onnx`. A hand-written SentencePiece/BPE is not a defensible production choice, and `sentencepiece` does not exist on npm (verified). | LOCKED (user, 2026-10-05) - add it; `@huggingface/tokenizers` stays the documented fallback if the measured delta breaches the M0 budget. **SUPERSEDED 2026-10-11 by Q8**: the measured cost of the library was a second ORT wasm of 26,861,777 bytes in `dist/`, so `@huggingface/tokenizers@0.2.0` was chosen instead. |
| D2 | Embedding identity | `embeddingVersion = modelId + ":" + tokenizerVersion + ":" + dimensions`, stamped on every chunk; a chunk whose version differs from the active one is never returned by search | A vector is only meaningful relative to the exact tokenizer that produced it (review `4, NH-01). | locked |
| D3 | Desktop asset policy | Every asset the app **executes** (ORT wasm, pdf.js worker) loads from the bundle; model/tokenizer **data** downloads go through `@tauri-apps/plugin-http` (Rust-side, outside the webview CSP) under Tauri and `fetch` in the browser build | Keeps `connect-src` minimal, removes the CDN dependency (NH-02), and makes the desktop path testable. | locked |
| D4 | CSP | `script-src 'self' 'wasm-unsafe-eval'`; no CDN origin added to `connect-src` for app assets; enforced by a source-parsing contract test | The current CSP is what makes the RAG runtime dead (NH-02). | locked |
| D5 | i18n enforcement | Extend the existing `no-restricted-syntax` block in `eslint.config.js` with an AST selector that rejects Arabic-script **string literals** outside `src/i18n/**` (comments untouched; specs allowlisted explicitly) | The rule was shape/parity-only, which is why NM-04 survived an i18n round. | locked |
| D6 | Persisted error text | Keep the stored value of `INTERRUPTED_TURN_ERROR` byte-stable (it is persisted into message rows and asserted by `repos.spec.ts`) and translate it at render through a known-value map; a real `errorCode` column is a separate, optional schema change | Changing a persisted literal is a data migration, not a translation. | LOCKED (user, 2026-10-05) - render-map option; no data migration, the stored literal stays byte-stable |
| D7 | Budget definition | The budget is byte-based: base entry JS at most 1,200,000 bytes (Vite reports 1000-based kB). Documented in the gate script and `docs/environment.md`. | Removes the "is kB 1000 or 1024" ambiguity that let the number drift. | locked |
| D8 | Advisory policy | `pnpm audit --prod` must be clean; every remaining advisory (dev or prod) must appear in `docs/security/dependency-advisories.md` with a justification and a re-review date, and the gate fails on an unregistered advisory | Makes "zero vulnerabilities" reproducible instead of stale. | locked |

## 1a. Answers received (2026-10-05)

The five questions in section 0 were put to the user and answered. Q1 and Q2 are now locked decisions; Q5 is blocked on a missing credential, not on a decision.

| # | Answer | Consequence for this plan |
|---|---|---|
| Q1 | **Add** `@huggingface/transformers` | D1 is locked. T1.0 proceeds and its measured chunk cost is checked against the M0 budget before T1.1 starts. |
| Q2 | Use the **recommended** option: keep the stored literal byte-stable, translate at render | D6 is locked. T3.1 does not touch the persisted value, so `repos.spec.ts` and every existing message row stay valid. |
| Q3 | **Windows first**; Linux may follow later | Windows NSIS is the only shipped artifact for this release. T6.4 is reduced to recording that Linux is a compile-check target, not a supported platform, and the release notes must say so. No macOS work. |
| Q4 | **No certificate available** | T6.5 becomes documentation-only: the installer is unsigned, and `docs/release-checklist.md` and the release notes must state the SmartScreen warning explicitly. No signing work is scheduled. |
| Q5 | **Provided 2026-10-11:** the key is in `.env` in the project root, variable `OPENCODE_API_KEY` | **ANSWERED.** The file exists, is gitignored (line 5) and untracked, and the key works (review section 13). T6.7 is unblocked: the provider-level checks are already recorded, while the app-level desktop turn still needs Step 3's injection seam. |
| Q7 | **Recommended option A, 2026-10-11:** keep D7 as the base-entry budget; keep the eager total reported by `check:bundle` and gate it only once T1.3 Step 9 makes the RAG chunks genuinely lazy | The budget the app pays at startup is the eager payload (entry + modulepreloaded chunks), which is already 1,309,757 bytes, but making it the gated number today would turn the new gate red immediately and train people to ignore it. LV-09 records the gap; T1.3 Step 9 closes it and flips the number in the same change. **تحديث 2026‑10‑11:** نُفِّذ Step 9 لكن الحمولة الفعلية لم تنقص (Rolldown يُصدر قطع `codeSplitting.groups` كاستيرادات ساكنة للمدخل)، فلم يُحوَّل الحدّ وبقيت الحمولة الفعلية معلومةً؛ التفاصيل في ADR 0004. |
| Q8 | **Option B, 2026-10-11:** use `@huggingface/tokenizers@0.2.0` for the tokenizer and drop `@huggingface/transformers`. | T1.0 measured both: the base entry never moves, but `transformers.js` adds a 539,281-byte lazy chunk **and 26,861,777 bytes of duplicated ORT wasm** because it pins `onnxruntime-web@1.31.0-dev` beside the app's 1.30.0. The app only needs tokenization, so that 26.9 MB would be dead weight in the NSIS payload. This explicitly supersedes D1's literal trigger, which did not fire. |

### Live verification inputs (updated 2026-10-11, after Q5 was answered)

- **Key:** `.env` in the project root, variable `OPENCODE_API_KEY`. Confirmed present, gitignored and untracked.
- **Free models, corrected against the live catalog:** `longcat-2.5-preview-free`, `step-5-preview-free`, `space-bunny`, `mimo-v2.6-flash`. `fledge-alpha-free` was dropped from the list on the user's instruction (2026-10-11); it is not in the catalog.
- **Key handling rules (non-negotiable):** the key is never printed, logged, echoed, written into any file in this repository, or included in a test fixture. It is read from the environment at run time only.
- **Verified provider facts (review section 13):** chat requires `x-opencode-session` (400 `MissingSessionID` without it) and the app already sends it; the authenticated catalog lists 38 models and the anonymous one 45, with no `pricing` or `context_length` published; a bad key yields 401 `AuthError`.
- The app has **no** env-based provider-key path: keys are entered in Settings and stored through the credential backend. An app-level turn still needs the **test-only injection seam** of T6.7 Step 3; the provider-level checks did not require it.
- **OpenCode Go** accepts ordinary HTTPS callers once the session header is present, so the desktop constraint concerns the app's browser path rather than the provider. The app-level turn is still verified from the packaged desktop app (T6.2/T6.7), and a refusal would be recorded as an observation rather than worked around.

## 2. File structure

**Create**

- `scripts/check-bundle.mjs` - the M0/T0.2 gate.
- `scripts/check-audit.mjs` - the M0/T0.1 gate.
- `scripts/render-env-tables.mjs` - regenerates the measured tables in `docs/environment.md` and the counts in `README.md` (M0/T0.3).
- `docs/security/dependency-advisories.md` - accepted-risk register (M0/T0.1).
- `docs/release-checklist.md` - the release gate as a checklist (M6/T6.8).
- `docs/plans/2026-10-05-production-readiness-progress.md` - the memory file (created with this plan).
- `docs/adr/0003-embedding-identity-and-tokenizer.md` (M1/T1.2).
- `docs/adr/0004-desktop-asset-and-csp-policy.md` (M1/T1.3).
- `docs/adr/0005-i18n-enforcement.md` (M3/T3.2).
- `src/lib/rag/embeddingVersion.ts` - the D2 helper (M1/T1.2).
- `src/lib/rag/modelCache.ts` - single model-cache writer (M1/T1.6).
- `src/lib/rag/cspContract.spec.ts` - the regression gate for D3/D4 (M1/T1.3).
- `src/features/chat/persistTurn.ts` - extracted from `ChatScreen.tsx` (M4/T4.1).
- `src/lib/chat/contextLimit.ts` - one context-limit resolver (M2/T2.5).
- `CHANGELOG.md` (M6/T6.6).

**Modify (by milestone)**

- M0: `package.json`, `.github/workflows/ci.yml`, `vite.config.ts` (comment only), `docs/environment.md`, `README.md`.
- M1: `src/lib/rag/{embedder,modelCatalog,modelDownloader,fileProcessor,tool,hybridSearch,keywordSearch,vectorIndex,sessionIndexer,reindexManager}.ts`, `src/types/rag.ts`, `src/lib/db/db.ts`, `src-tauri/tauri.conf.json`.
- M2: `src/lib/chat/{dispatch,context}.ts`, `src/lib/providers/{registry,keyTest,modelCatalog}.ts`, `src/features/chat/{ChatScreen,ContextMeter,ResultCard}.tsx`.
- M3: `eslint.config.js`, `src/i18n/{en,ar}.ts`, `src/lib/providers/keyTest.ts`, `src/lib/db/repos/{attempts,reconcile}.ts`, `src/lib/markdown/writer.ts`, `src/lib/export/sessionExporter.ts`, `src/features/chat/ResultCard.tsx`, `src/lib/limits.ts`, `src/lib/startupRecovery.ts`, `src/state/sessionsStore.ts`.
- M4: `src/features/chat/ChatScreen.tsx`.
- M5: `e2e/*.spec.ts`, `src/styles/tokens/*.css` (only if a contrast failure requires a token change).
- M6: `src-tauri/tauri.conf.json`, `.github/workflows/ci.yml`, `package.json`, `docs/environment.md`.

---

## Milestone M0 - Truthful gates and instrumentation

**Why first:** three of the review's findings are claims that stopped being true (NM-06, NM-07, and the README/environment drift). Fixing the product without fixing the gates means the next regression hides the same way.

**Exit criteria:** `pnpm check:all` fails when a new production advisory appears or the base bundle exceeds budget; the measured tables in `docs/environment.md` are generated; CI treats a production advisory as blocking; `pnpm test:e2e` is explicit about which project runs on Linux.

### T0.1 - Make the dependency audit real

**Recorded 2026-10-11:** completed; the steps below are ticked retroactively to match the ledger, which already carried T0.1 as **COMPLETED** with evidence. Every step was performed as written (baseline captured, register written including the override evaluation of Step 3, `scripts/check-audit.mjs` written and wired into `check:all` and CI, `docs/environment.md` corrected). The gate now exits 2 on an unreadable input after a later hardening pass.

**Files:** Create `scripts/check-audit.mjs`, `docs/security/dependency-advisories.md`; modify `package.json`, `.github/workflows/ci.yml`, `docs/environment.md` (line 117).

- [x] Step 1: Capture the baseline. Run `pnpm audit --json` and `pnpm audit --prod --json` and save both outputs beside the register (paths in the register header).
- [x] Step 2: Write `docs/security/dependency-advisories.md` with one row per advisory: id, package, severity, path, whether it is in the production graph, why it is (or is not) reachable from Shura code, decision (fix / override / accept), owner, re-review date. The `mammoth -> argparse -> sprintf-js` row records the `docxExtractor.ts` API-path reasoning from review `4 NM-06 and the fact that upstream has no patched version.
- [x] Step 3: Attempt the cheap fixes first and re-measure: `pnpm why sprintf-js`, and check whether a `pnpm.overrides` entry for `argparse`/`sprintf-js` clears the production advisory without breaking `mammoth` (`pnpm test` must stay green). Record whether anything changed.
- [x] Step 4: Write `scripts/check-audit.mjs`: run the audit as a child process, parse `metadata.vulnerabilities`, PASS when production counts are zero or every reported advisory id appears in the register, FAIL otherwise. Also FAIL when a register row has a past re-review date.
- [x] Step 5: Wire it: add `"audit:check": "node scripts/check-audit.mjs"` and append it to `check:all` after `pnpm test:coverage`.
- [x] Step 6: In `.github/workflows/ci.yml`, replace the `continue-on-error` audit step with a blocking `pnpm audit:check`; keep the full JSON audit as an uploaded artifact for the record.
- [x] Step 7: Replace `docs/environment.md` line 117 with the measured result of this run plus a pointer to the register, and delete the "zero vulnerabilities" wording.

**Acceptance:** `pnpm audit:check` exits 0 on the current tree with the register explaining all 11 advisories; an unregistered advisory in the script's test fixture makes it exit 1; `docs/environment.md` no longer contains a zero-vulnerability claim.

### T0.2 - Make the bundle budget a gate

**Recorded 2026-10-11:** completed and measured (they are ticked retroactively to match the ledger, which carried T0.2 as **COMPLETED**). One deviation: Step 3's temporary constant edit was replaced by a `--budget` flag, so both directions are provable without touching the source and the tree is never briefly wrong.

**Files:** Create `scripts/check-bundle.mjs`; modify `package.json`, `vite.config.ts` (comment only).

- [x] Step 1: Write the script: locate the entry JS referenced by `dist/index.html`, read its byte size, compare with the budget constant 1,200,000, and print `base=<n> bytes headroom=<n> bytes`. Also assert the lazy chunks exist (`pdf-*`, `ort.bundle.min-*`, `rag-tool-*`, `rag-embedder-*`) so a regression that inlines them fails loudly.
- [x] Step 2: Add `"check:bundle": "node scripts/check-bundle.mjs"` and append it to `check:all` after `pnpm build`.
- [x] Step 3: Verify both directions: PASS on the current build, and FAIL after temporarily setting the budget below the measured size (record both outputs in the progress file, then restore the constant).
- [x] Step 4: Update the `vite.config.ts` comment so it states that the warning limit is advisory and the gate is `scripts/check-bundle.mjs`.

**Acceptance:** `pnpm check:bundle` prints the measured base size and headroom; a lowered budget makes it exit non-zero.

### T0.3 - Generate the measured documentation numbers

**Files:** Create `scripts/render-env-tables.mjs`; modify `docs/environment.md`, `README.md`, `vite.config.ts` (reporters only), `.github/workflows/ci.yml`, `package.json`.

- [x] Step 1: Add generated-value markers. **Deviation (simpler, same goal):** instead of replacing whole tables, the documents wrap only the measured value in `<!--G:key-->value<!--/G-->` spans, because the surrounding cells are hand-written Arabic and a generated table would move that prose into the script. Superseded the block-marker idea.
- [x] Step 2: `scripts/render-env-tables.mjs` computes 15 keys from `dist/index.html` + `dist/assets/*`, `coverage/coverage-summary.json` and `coverage/vitest-report.json`, and refuses to write (exit 2) when any input is missing. `vite.config.ts` gained the `json-summary` coverage reporter and a `json` test reporter writing `coverage/vitest-report.json`, so the counts are measured rather than typed.
- [x] Step 3: Second run is byte-identical (SHA-256 of README.md and docs/environment.md unchanged); `pnpm docs:numbers:check` exits 0 and exits 1 after a single corrupted value.
- [x] Step 4: `docs:numbers` and `docs:numbers:check` in `package.json`; `.github/workflows/ci.yml` runs `pnpm docs:numbers && git diff --exit-code -- README.md docs/` in the web job after `check:all`, where `dist/` and `coverage/` exist. Cross-platform byte stability of the coverage percentages and of the bundler's gzip is reasoned from the pinned Node 24 line, not measured on Linux.
- [x] Step 5: README's 957/94, its coverage percentages and its 1,071.15 kB are now generated; the false "zero vulnerabilities" claim is replaced with the `audit:check` verdict and the 11 registered advisories; the claim that the RAG chunks load on demand is corrected to the measured 1,309.76 kB eager payload (LV-09). `docs/environment.md` kept two `## 8.` headings that are now `## 8.1`/`## 8.2`, and its task-15 87/87 row is marked historical instead of contradicting the measured 1005.

**Acceptance:** `pnpm docs:numbers` leaves the tree clean; the tables match the build just produced.

### T0.4 - Make the E2E project explicit in CI

**Files:** Modify `.github/workflows/ci.yml`, `README.md` (the verification-command block).

- [x] Step 1: Measured 2026-10-11 on Windows with a fresh `dist/`: `pnpm test:e2e` runs both projects. The browser project passes 12/12; the tauri project is attempted and all 4 tests fail with `Error: connect ECONNREFUSED 127.0.0.1:6274` because no desktop webview is listening for the tauri-playwright bridge. Bare `pnpm test:e2e` therefore exits 1. Recorded in the progress ledger. The CI e2e step was configured that way, so it was red on Linux for the same reason.
- [x] Step 2: It is, so the Linux web job now runs `pnpm test:e2e:browser`. The desktop project is left for the Windows job that can actually launch the app; T6.1 owns adding it there (the desktop suite needs `pnpm tauri:dev:e2e` plus the bridge, and `pnpm test:e2e:tauri` already exists for that).
- [x] Step 3: Four-line comment above the step in `.github/workflows/ci.yml` naming the browser project, the reason the tauri project cannot run there, and where it belongs.

**Acceptance:** the CI configuration names its E2E project explicitly and the recorded local result matches it.

---

## Milestone M1 - RAG correctness (the two release blockers)

**Exit criteria:** an Arabic query produces meaningful, reproducible embeddings; switching embedding model or tokenizer version cannot mix vector spaces; the packaged desktop app can initialise ORT and pdf.js under the production CSP; `search_documents` honours `scope`.

### T1.0 - Spike: lock the tokenizer choice (D1)

**Files:** `docs/adr/0003-embedding-identity-and-tokenizer.md` (written here with the measurements), `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` (the build-approval entry).

- [x] Step 1: Added `@huggingface/transformers@4.3.1` and measured with a temporary reference inside `loadTokenizer` plus `pnpm exec vite build` (reverted after each build). Base entry **unchanged at 1,099,043 bytes** (still under budget), `rag-embedder` 102,679 -> 102,873, new lazy chunk `transformers.web-*` **539,281 bytes** (gzip 155.43 kB), and a **second ORT wasm asset of 26,861,777 bytes** because the library pins `onnxruntime-web@1.31.0-dev` next to the app's own 1.30.0. `dist/assets` grew 31,112,594 -> 58,513,846 bytes. Side effect found and fixed: the install added `onnxruntime-node` (287.1 MB) whose postinstall left `pnpm install --frozen-lockfile` exiting 1, so `pnpm-workspace.yaml` now denies that script explicitly.
- [x] Step 2: Golden vectors recorded in ADR 0003: `مرحبا بالعالم` -> `[0, 665, 193478, 258, 1705, 77796, 2]` (tokens `▁م` `رحب` `ا` `▁بال` `عالم`), `hello world` -> `[0, 33600, 31, 8999, 2]` (tokens `▁hell` `o` `▁world`), CLS `<s>`=0 and SEP `</s>`=2. Cross-checked with the second implementation: `@huggingface/tokenizers` returns the identical ids on the same `tokenizer.json`, and `decode(ids, {skip_special_tokens: true})` reproduces both strings exactly. The model's `tokenizer.json` is 17,082,730 bytes and its `tokenizer_class` is `XLMRobertaTokenizer`.
- [x] Step 3: The literal trigger did not fire - the base entry does not move in either case - but the measurement is recorded because it exposed a cost the plan did not model. Measured the fallback the same way: new chunk `tokenizers-*` **34,610 bytes** (gzip 10.72 kB), `rag-embedder` 102,797, **no new wasm**, `dist/assets` 31,147,331 bytes, 0.3 MB installed and zero dependencies. Comparison table in ADR 0003. The choice is a change to the locked D1, so it is put back to the user as a decision rather than taken silently.
- [x] Step 4: **Signed off 2026-10-11 as option B.** `@huggingface/transformers` was removed and `@huggingface/tokenizers@0.2.0` added; ADR 0003 records the decision, the reasons and the fact that it supersedes D1's literal trigger. `package.json` and `pnpm-lock.yaml` updated, and `pnpm-workspace.yaml` was restored to its original content because no package needs a build approval any more.

**Acceptance:** ADR 0003 contains a measured decision with real ids, not a preference.

### T1.1 - Replace the placeholder tokenizer (NH-01a)

**Files:** Modify `src/lib/rag/embedder.ts` (delete `SimpleTokenizer`, lines 310-340), `src/lib/rag/modelCatalog.ts` (add `tokenizerUrl`, `tokenizerVersion`), `src/lib/rag/modelDownloader.ts`, `src/types/rag.ts`; Test `src/lib/rag/embedder.spec.ts`.

- [x] Step 1: Failing tests written in `embedder.spec.ts`: (a) the two golden strings; (b) first id = CLS, last = SEP; (c) `maxLength` truncation is exact; (d) an unknown `modelId` throws instead of falling back. Three more cover the defect itself: the vocabulary is read from the file, two different words cannot collide, one instance per model, and the assets are cached in IndexedDB. The golden strings are guarded by `SHURA_GOLDEN_TOKENIZER_DIR` because the real `tokenizer.json` is 17,082,730 bytes - with the variable unset they report skipped, never a false pass.
- [x] Step 2: RED confirmed for the right reason: `pnpm exec vitest run src/lib/rag/embedder.spec.ts` -> **6 failed**, and the received value was `SimpleTokenizer { nextId: 1, vocab: Map { ... } }` with ids `[2, 1, 2, 3]` where the contract requires `[0, 4, 5, 2]` - the invented counter ids colliding with the special tokens.
- [x] Step 3: Implemented: `loadTokenizer(modelId)` is async, caches one promise per `modelId` (deleted on failure so a retry works), throws `Unknown embedding model` for an unknown id, and loads `tokenizer.json` + `tokenizer_config.json` through the model cache before constructing `@huggingface/tokenizers@0.2.0` (Q8; `AutoTokenizer` belonged to the removed library). `SimpleTokenizer` deleted. **Deviation:** `src/types/rag.ts` was not changed - the new fields (`tokenizerUrl`, `tokenizerConfigUrl`, `tokenizerVersion`) belong on `EmbeddingModelInfo`, not on the `RagModel` row.
- [x] Step 4: GREEN: 17 passed / 3 skipped without the real file, and **20 passed** with `SHURA_GOLDEN_TOKENIZER_DIR` set - both golden strings plus the pinned SHA-256 of the file. `pnpm typecheck && pnpm lint` exit 0, `pnpm check:all` -> PASS exit 0 (97 files, 1012 passed / 3 skipped, base entry **still 1,099,043 bytes**, audit 11/11 registered).
- [x] Step 5: Ledger row updated with the RED/GREEN evidence, the measured `tokenizers-*` chunk and the new `check:bundle` guard.

**Acceptance:** tokenizer conformance tests PASS; `SimpleTokenizer` no longer exists in the tree.

**Result (2026-10-11): PASS.** `SimpleTokenizer` is gone from the tree, the conformance tests pass, and the two golden vectors from ADR 0003 were reproduced by the shipped wrapper on the real `tokenizer.json` - not only by the throwaway spike. The library loads as its own lazy `tokenizers-*` chunk (34,610 bytes), which `pnpm check:bundle` now asserts so a heavier tokenizer cannot come back in through the front door.

### T1.2 - Embedding identity and invalidation (NH-01b)

**Files:** Create `src/lib/rag/embeddingVersion.ts`, `docs/adr/0003-embedding-identity-and-tokenizer.md`; modify `src/lib/db/db.ts` (version 6), `src/types/rag.ts`, the chunk writer(s) under `src/lib/rag/`, `src/lib/rag/vectorIndex.ts`, `hybridSearch.ts`, `keywordSearch.ts`.

- [x] Step 1: Failing test written first, in a new `src/lib/rag/embeddingVersion.spec.ts`: the identity string, an unknown model yielding `null`, the staleness rules, and - through the real `search_documents` tool in keyword mode - a chunk from a foreign space and an unstamped chunk must not appear in the results while the current-space chunk does.
- [x] Step 2: RED confirmed: `Failed to resolve import "./embeddingVersion"` - the identity did not exist, and the search path had no filter at all.
- [x] Step 3: Implemented `embeddingVersionOf` / `currentEmbeddingVersion` / `isChunkStale` in `src/lib/rag/embeddingVersion.ts`; `RagChunk.embeddingVersion?` added; Dexie **v6** adds the `embeddingVersion` index to `rag_chunks` - additive, no upgrade function, no row deleted. Both writers (`documentManager`, `sessionIndexer`) stamp from the **resolved** model (the one that actually embedded), not from the requested id.
- [x] Step 4: The tool filters every mode (keyword included) to the active space; `getVectorIndex(modelId, dimensions, version)` clears an index whose version changed, and the search path rebuilds it from the current chunks when it is empty. This also fixed two adjacent defects found while wiring it: the index was keyed by the *requested* id at write time but by the *resolved* id at search time (a silent miss for an unknown configured model), and `buildFromChunks` - documented as "called on app startup" - was never called by anything, so semantic search was empty after every restart.
- [x] Step 5: `RagStatusChip` now counts stale chunks (new `countStaleChunks` in `embeddingVersion.ts`, deliberately not in `documentManager` so the eager payload does not pull `onnxruntime-web`) and shows a warning in both locales via new `rag.chipStale` keys; precedence is indexing > errors > stale > ok.
- [x] Step 6: Migration test added to `src/lib/db/migration.spec.ts`: a v5 database with an unstamped chunk opens at v6 with the row intact, the row is queryable and stale, and a stamped row is found through the new index.
- [x] Step 7: `pnpm check:all` -> PASS exit 0.

**Acceptance:** a model/tokenizer switch can never return a vector from the previous space; v5 data survives the upgrade; ADR 0003 records the version scheme.

**Result (2026-10-11): PASS.** All three hold. `pnpm check:all` -> exit 0 (98 files, 1020 passed / 3 skipped), base entry 1,099,763 bytes (budget 1,200,000), `tokenizers-*` chunk asserted by `check:bundle`, audit 11/11. **Honest limitation:** every chunk stored before v6 is now treated as stale, so search returns nothing until documents are re-indexed - correct, because those vectors came from the deleted substitute tokenizer, and the status chip says so rather than failing silently. The chunk-stamping test data in `tool.spec.ts` was updated to stamp the current version (the fixtures must represent current chunks); the two fallback tests in `documentManager.spec.ts` / `sessionIndexer.spec.ts` now expect the resolved model id as the index key, which is the bug fix described in Step 4.

### T1.3 - Local assets and the production CSP (NH-02, NL-06)

**Files:** Modify `src/lib/rag/embedder.ts` (line 108), `src/lib/rag/fileProcessor.ts` (lines 71-72), `src/lib/rag/modelDownloader.ts`, `src-tauri/tauri.conf.json` (line 23); create `src/lib/rag/cspContract.spec.ts`, `docs/adr/0004-desktop-asset-and-csp-policy.md`.

- [x] Step 1: Write the failing contract test: parse `src-tauri/tauri.conf.json`; assert `script-src` contains `'wasm-unsafe-eval'`; scan `src/lib/rag/**/*.ts` for absolute `http(s)://` string literals and assert each is either a bundled asset (`?url` / `new URL(..., import.meta.url)`) or explicitly listed in a documented `connect-src` allowlist in the same file.
- [x] Step 2: Confirm RED (the test must fail on the current CDN URLs and the current CSP).
- [x] Step 3: Replace the ORT CDN path with the locally emitted wasm asset. Verify the exact supported API for `ort.env.wasm.wasmPaths` in the installed `onnxruntime-web@1.30.0` before coding; if the Vite-emitted asset cannot be addressed that way, record the deviation and use the mechanism the package actually supports.
- [x] Step 4: Replace the pdf.js worker CDN URL with a bundled worker (Vite `?url` / `new URL(..., import.meta.url)`), and verify a PDF parses in the browser E2E build.
- [x] Step 5: Route model/tokenizer downloads through `@tauri-apps/plugin-http` under Tauri and `fetch` otherwise, behind one small module so both paths are testable and neither adds a CDN origin to `connect-src`.
- [x] Step 6: Add `'wasm-unsafe-eval'` to `script-src` in `src-tauri/tauri.conf.json`; leave every other directive at its current restrictive value; document each `connect-src` entry with the code that needs it.
- [x] Step 7: Confirm GREEN, then `pnpm build` and check that the 28 MB `ort-wasm-*` asset is now referenced (not dead weight) and that the base bundle is still under budget.
- [x] Step 8: Write ADR 0004 (policy: executed assets bundled, data downloads via the Rust HTTP plugin, CSP minimal and contract-tested).

- [x] Step 9: Make the RAG entry points genuinely lazy. `dispatch.ts` line 7 statically imports `@/lib/rag/tool` and `RagSettings.tsx` line 7 imports `@/lib/rag/embedder`, so `dist/index.html` modulepreloads both chunks and the whole eager payload is 1,309,757 bytes - 109,757 over the 1,200,000-byte budget that D7 applies to the base entry alone (LV-09). Switch those edge imports to dynamic `import()`, re-measure, and record the eager total printed by `pnpm check:bundle`. Gating the eager total rather than the base entry changes D7 and needs the user's decision; record the measured number either way.

**Acceptance:** the contract test PASSes and would FAIL if a CDN URL or a missing `wasm-unsafe-eval` were reintroduced; `pnpm build` shows the local wasm is used; the browser E2E still passes.

**النتيجة (2026‑10‑11):** نُفِّذت الخطوات 1‑8 كاملة. اختبار التعاقد كُتب أولًا وأُثبت RED (4/4 فاشلة) ثم GREEN.
ملف wasm للمحرّك ولاصقه وعامل pdf.js تُصدَّر محليًا بـ`?url` وتُشار إليها؛ والاستيراد صار من `onnxruntime-web/wasm`
لا المدخل الافتراضي، فلم يُبنَ ملف `jsep` البالغ 28,312,028 بايت. التنزيلات تمرّ بـ`getTransportFetch()` وبوابة
Rust `https://huggingface.co/*`، وبقيت `connect-src` بلا أصل جديد. أُضيفت `'wasm-unsafe-eval'` وحدها إلى
`script-src`، و`check-bundle.mjs` يتحقق الآن أن الأصول الثلاثة مُصدَّرة **ومُشار إليها** من JS مُصدَّر.
`pnpm build` PASS؛ `pnpm check:bundle` PASS (الأساسية 1,100,062 من 1,200,000؛ الفعلية 1,314,542)؛
`pnpm check:all` PASS (98 ملفًا، 1020 ناجحًا / 3 متجاوزة)؛ `pnpm test:e2e:browser` PASS (12/12).
و`dist/` **انخفض** نحو 12.78 ميبيبايت بدل أن يرتفع.

**انحراف مسجَّل في Step 9:** الاستيرادات جُعلت ديناميكية كما طُلبت (وأُضيف `documentManager.ts`، وهو جسر ساكن لم
تسمّه الخطة)، **لكن الحمولة الفعلية لم تنقص**: قائمة `modulepreload` تُشتق من استيرادات قطعة المدخل الساكنة،
وRolldown يُصدر قطع `codeSplitting.groups` كاستيرادات ساكنة للمدخل. إزالة التجميع (تجربتان أُعيدتا) تُلغي التحميل
المسبق لكنها تنقل شيفرة RAG إلى المدخل فتصبح الحزمة الأساسية 1,304,578 بايت، أي فوق الحدّ. لذلك **لم تُحوَّل بوابة
D7** (شرط Q7 غير متحقق). **SKIPPED:** التحقق من تحليل PDF في المتصفح (Step 4) — لا يوجد اختبار E2E يرفع ملفًا أو
يبحث في RAG، والتحقق الفعلي من مسار wasm يبقى على T6.2. القياسات والتفاصيل في
`docs/adr/0004-desktop-asset-and-csp-policy.md`.

### T1.4 - Implement the `scope` filter (NM-05)

**Files:** Modify `src/lib/rag/tool.ts` (lines 52-84), `hybridSearch.ts`, `keywordSearch.ts`, possibly `src/lib/db/db.ts` (index); Test `tool.spec.ts` and the search specs.

- [x] Step 1: Write the failing test: create one upload document, one session document and one external document; `scope: "uploads"` must return only the upload's chunks.
- [x] Step 2: Confirm RED (today every scope returns everything).
- [x] Step 3: Decide and record how a chunk learns its document's `source`: join by `documentId` at query time, or denormalise `source` into the chunk. Choose the join unless measured cost justifies denormalisation; index the key you filter on.
- [x] Step 4: Thread the filter through the search functions and apply it before ranking; keep `scope` in the cache key now that it changes results, and add a test that two scopes cache separately and return different content.
- [x] Step 5: `pnpm typecheck && pnpm lint && pnpm test`.

**النتيجة (2026‑10‑11):** نُفِّذت الخطوات 1‑5. كُتب الاختبار أولًا وأُثبت RED (4 فاشلة من 22)، ثم GREEN.
الترشيح **وصل** لا نسخة: `RagChunk` لا يحمل مصدر مستنده، والقطعة تُنسب إلى `RagDocument.source` عبر
`documentId`؛ ونسخ الحقل داخل القطعة كان سينحرف عند تغيّر المستند. و`getDocuments({ source })` صار
يستعلم فهرس `source` القائم منذ المخطط v4 بدل مسح الجدول كله، فلم يُحتَج إلى تغيير مخطط. والترشيح يقع
**قبل الترتيب** في الأنماط الثلاثة، ولذلك لم تُمسّ `hybridSearch.ts` ولا `keywordSearch.ts`: هما
دالتا ترتيب محض، والتصفية قبلهما أنظف من تمرير معامل إلى كل منهما. و`scope` كان في مفتاح الذاكرة
المؤقتة منذ T1.2، وأُضيف اختبار يثبت أن نطاقين يعيدان محتوى مختلفًا لا مجرد مفتاحين.

**عيبان مجاوران كشفهما التنفيذ:** (1) فهرس المتجهات في الذاكرة يضم الفضاء النشط كله لا النطاق، فنتائجه
تُرشَّح الآن إلى القطع المسموح بها؛ وقبل ذلك كانت نتيجة فهرس لقطعة مستبعدة تُنسَّق مستندًا فارغًا بمصدر
`unknown` وتُسلَّم إلى النموذج — وهو التسريب نفسه الذي يمنعه النطاق. (2) الفهرس يُبنى الآن من **الفضاء
النشط كله** لا من النطاق: بناءٌ من نطاق واحد كان سيُخفي بقية النطاقات عن كل بحث لاحق، لأن الفهرس لا
يُعاد بناؤه ما دام حجمه غير صفر (اختبار يثبت ذلك، RED ثم GREEN). التحقق: `pnpm typecheck` و`pnpm lint`
PASS، `pnpm test` PASS (100 ملفًا، 1034 ناجحًا / 3 متجاوزة)، واختبار تكامل على Dexie حقيقي
(`scopeFilter.integration.spec.ts`) 4/4: مستند مرفوع وآخر لجلسة وثالث خارجي.

**Acceptance:** each scope returns exactly its own sources; the tool description and its behaviour agree.

### T1.5 - Neutralise the tool-result delimiters (NL-04)

**Files:** Modify `src/lib/rag/tool.ts` (line 173); Test `tool.spec.ts`.

- [x] Step 1: Write the failing test: a document whose file name contains `]`, a newline, and the literal `[END DOCUMENT` must not be able to forge the closing delimiter.
- [x] Step 2: Confirm RED.
- [x] Step 3: Implement escaping/stripping (remove or bracket `[` and `]` and collapse newlines in the interpolated `source`) so the wrapper stays unambiguous.
- [x] Step 4: GREEN plus `pnpm check:all`.

**النتيجة (2026‑10‑11):** نُفِّذت الخطوات 1‑4. كُتب الاختبار أولًا وأُثبت RED (فشلان من 26: اسم ملف مزوَّر أنتج
علامتَي `[END DOCUMENT]` وترويسة ممزَّقة على سطرين)، ثم GREEN. الغلاف يُعقَّم الآن من **طرفَي** الإقحام لا
من طرف واحد: `sanitizeSource` تطوي كل مسافة/فاصل سطر إلى مسافة واحدة وتُزيل الأقواس المربعة من المصدر،
و`neutraliseDelimiters` تحوّل `[BEGIN/END DOCUMENT` في **نصّ المستند** إلى `(BEGIN/END DOCUMENT)`.
التوسيع مقصود: النصّ نفسه هو ما يملكه المهاجم كاملًا، فلو بقي فيه رمز الغلاف لما صمد الغلاف أصلًا. واسم
عادي مثل `shura.txt` يبقى **بايتًا ببايت** كما كان (اختبار مساواة تامة يثبته). `pnpm lint` فشل أولًا
بـ`no-control-regex` على صنف أحرف التحكم، فاستُبدل بـ`\s` الذي يغطي `\n` و`\r` و`\u2028` و`\u2029`
أصلًا: التغيير أصغر وأنظف. التحقق: `pnpm typecheck` و`pnpm lint` PASS، `pnpm check:all` PASS
(الأساسية 1,100,062 من 1,200,000، والفعلية 1,315,234 إعلامية، والتدقيق 11/11)، و`pnpm docs:numbers`
و`pnpm docs:numbers:check` PASS.

**Acceptance:** the forged-delimiter test PASSes and the wrapper text is unchanged for ordinary file names.

### T1.6 - One writer for the model cache (NL-05)

**Files:** Create `src/lib/rag/modelCache.ts`; modify `src/lib/rag/modelDownloader.ts` (line 31, lines 70-81) and `src/lib/rag/embedder.ts` (lines 279-299); Test `modelDownloader.spec.ts`, `embedder.spec.ts`, new `modelCache.spec.ts`.

- [x] Step 1: Write the failing test: the downloader path and the lazy-embed path must produce byte-identical `rag_models` rows for the same model (same `label`, same `dimensions`, same `tokenizerVersion`).
- [x] Step 2: Confirm RED.
- [x] Step 3: Implement the single `putModel/getModel/downloadModel` API and make both call sites use it; keep the "cache write failure is non-fatal" behaviour in one place with its comment.
- [x] Step 4: GREEN plus `pnpm check:all`.

**Acceptance:** one module writes the tables; both paths are covered by the identity test.

**النتيجة (2026‑10‑11):** نُفِّذت الخطوات 1‑4. كُتب الاختبار أولًا وأُثبت RED بثلاث نتائج: ملفّا `modelCache.spec.ts` و`modelDownloader.spec.ts` لم يستطيعا حلّ `./modelCache` (الوحدة غير موجودة)، واختبار `embedder.spec.ts` فشل فشلًا حقيقيًا — المسار الكسول كتب `label: "multilingual-e5-small"` بدل تسمية الكتالوج `"Multilingual E5 Small (recommended for Arabic)"`. ثم أُنشئ `src/lib/rag/modelCache.ts` كاتبًا وحيدًا للجدولين، وكل مسار يمرّ به الآن.

الواجهة المنفَّذة: `putModel` (يرمي: التنزيل الصريح يجب أن يعرف أن ما نزّله لم يُحفظ)، و`putModelQuietly` (الموضع الوحيد الذي يُمتصّ فيه فشل الكتابة، بوصفه وتعليله)، و`getModel`، و`getModelBytes`، و`listModels`، و`deleteModel`، و`getTokenizerAsset`/`putTokenizerAsset` لملفَّي المُرمِّز — كانا يُكتبان في `rag_model_blobs` من `embedder.ts` فنُقلا إلى الوحدة نفسها، حتى يصير الجدولان بمالك واحد. الوصف (`label` و`dimensions`) يُقرأ من `modelCatalog` لا من المستدعي، فيستحيل أن يتباعد الصفّان. الخطوة 1 ذكرت `tokenizerVersion` وهو ليس حقلًا في الصف الوصفي؛ المقارنة جرت على حقول الصف فعلًا (`id` و`modelId` و`label` و`dimensions` و`sizeBytes`).

انحراف مُسجَّل عن حرف الخطة: `downloadModel` بقي في `modelDownloader.ts` ولم يُنقل إلى الوحدة الجديدة، لأن التنزيل (البثّ و`content-length` وتقدّم التنزيل والنقل الموحّد) شأن تنزيل لا شأن كاش؛ ما انتقل هو الكتابة في الجدولين وحدها. وأُزيلت معامل `dimensions` من `loadEmbeddingModel`/`doLoadModel` (ومن موضعَي استدعائهما و12 موضعًا في الاختبارات) لأن الكاش لم يبقَ يقرأها، ومعامل يُمرَّر ولا يُستعمل هو نفسه ما يُنتج الانحراف لاحقًا.

التغطية المتبادلة للمسارين: `embedder.spec.ts` يثبّت أن المسار الكسول يكتب تسمية الكتالوج وأبعاده، و`modelDownloader.spec.ts` يثبّت أن صفّ التنزيل الصريح مطابق تمامًا لِما يكتبه الكاتب المشترك لنفس البايتات (الفارق الوحيد المسموح طابع الوقت). و`modelCache.spec.ts` يفحص الشيفرة المنتَجة (138 ملفًا غير اختباري) ويفشل إن كتب أي ملف خارج `modelCache.ts` في `rag_models` أو `rag_model_blobs`؛ وأُثبت أن الفحص غير سطحي — النمط نفسه يطابق السطر القديم `await db.rag_models.put({`. التحقق: `pnpm typecheck` و`pnpm lint` PASS، و`pnpm exec vitest run src/lib/rag` -> 20 ملفًا، **251 passed / 3 skipped**، و`pnpm check:all` PASS (101 ملفًا، **1048 passed / 3 skipped**، التغطية 88.63/82.11/86.57/92.59، الأساسية 1,099,860 من 1,200,000 والفعلية 1,315,097 إعلامية، والتدقيق PASS)، و`pnpm docs:numbers` و`:check` PASS.

---

## Milestone M2 - Chat pipeline correctness

**Exit criteria:** every MEDIUM/LOW chat finding from review `4 has a regression test that fails on the old behaviour; the context meter and the context gate can never disagree.

### T2.1 - Register the search tool only when its result can be consumed (NM-01)

**Files:** Modify `src/lib/chat/dispatch.ts` (lines 128-129), `src/features/chat/ChatScreen.tsx` (line 59); Test `dispatch.spec.ts`.

- [x] Step 1: Failing test: with agent mode off and the tool registered, a tool-call finish must not be reported as a completed answer; with agent mode on, the tool result must reach a second step.
- [x] Step 2: RED.
- [x] Step 3: Pass an explicit tool set into `dispatchTurn` derived from the same predicate that decides the step budget, so "tool available" and "steps available to use it" become one decision.
- [x] Step 4: GREEN plus `pnpm check:all`.

**Acceptance:** it is impossible to register `search_documents` with `isStepCount(1)`.

**النتيجة (2026-10-11):** نُفِّذت الخطوات 1-4. كُتب الاختبار أولًا وأُثبت RED: `pnpm exec vitest run src/lib/chat/dispatch.spec.ts` -> **1 failed / 14 passed (15)**، والفشل هو العلة نفسها: مع `multiStepTools: false` كان جسم الطلب الخارجي يحمل مخطط `search_documents` كاملًا (`tools: [{ type: "function", function: { name: "search_documents", … } }]`) بينما الميزانية خطوة واحدة — أي أن الأداة تُعرض على النموذج ولا يمكن أن تعود نتيجتها إليه.

الإصلاح قرار واحد في الموضع الذي تُبنى فيه خيارات `streamText`: `const stepBudget = args.multiStepTools ? TOOL_STEP_BUDGET : 1;` ثم `tools` لا تكون معرَّفة إلا إذا كان `stepBudget > 1`، و`stopWhen: isStepCount(stepBudget)`. فصار «الأداة متاحة» و«الخطوات متاحة لاستهلاكها» تعبيرًا واحدًا، ويستحيل بنيويًا تسجيل `search_documents` مع `isStepCount(1)`. وميزة جانبية مقصودة: الاستيراد الديناميكي (LV-09) صار داخل الفرع نفسه، فمع خطوة واحدة لا تُبنى الأداة ولا تُحمَّل وحدة RAG أصلًا عند إرسال رسالة.

انحراف مُسجَّل عن قائمة ملفات الخطة: `ChatScreen.tsx` لم يحتج تغييرًا. المسند `multiStepTools` كان أصلًا المصدر الوحيد للقرار، والاقتران يجب أن يُفرض حيث تُضبط خيارات `streamText`؛ ولو مرّرت الشاشة طقم أدوات مبنيًا لعادت وحدة الأداة (ومحرّك ONNX خلفها) إلى الوارد الأساسي، وهو عكس ما أُنجز في T1.3. وأُعيد كتابة الاختبار الذي كان يوثّق العلة (كان اسمه `single-step: النموذج يستدعي الأداة لكن البث يتوقف بعد خطوة واحدة`) ليصير اختبار عقد مخالف: مزود يعيد نداء أداة لم تُعرض لا يُنفَّذ (`onToolExecutionStart` لا يُطلق) ولا يُفشل الدور، ويُحفظ النص الجزئي، وجسم الطلب بلا `tools`.

التحقق: `pnpm typecheck` PASS و`pnpm lint` PASS، و`pnpm exec vitest run src/lib/chat/dispatch.spec.ts` -> **15 passed (15)**، و`pnpm check:all` PASS exit 0 (101 ملفًا، **1050 passed / 3 skipped** من 1053، التغطية 88.63 / 82.13 / 86.57 / 92.59، الوارد الأساسي 1,099,887 بايت من 1,200,000 والفارق 100,113، والفعلية 1,315,124 إعلامية، والقطع والأصول والتدقيق PASS)، و`pnpm docs:numbers` و`:check` PASS. ملاحظة نطاق: نصف NM-01 المتعلق بالكلفة — الافتراضي `agentMode: "always"` يضع كل دور عادي في وضع متعدد الخطوات — لم يُمسّ هنا.

### T2.2 - Never report a truncated stream as done (NM-02)

**Files:** Modify `src/lib/chat/dispatch.ts` (end-of-stream classification), `src/lib/chat/chatController.ts` (the two turn aggregations), `src/types/chat.ts`, `src/lib/db/repos/{identity,messages,attempts,reconcile}.ts`, `src/state/sessionsStore.ts`, `src/features/chat/hooks/{useOperationProgressSync,useSummaryExtraction}.ts`, `src/lib/chat/operationCoordinator.ts`, `src/lib/markdown/{writer,parser}.ts`, the status UI (`ResultCard.tsx`, `SummaryCard.tsx`, `StatusAnnouncer.tsx`) and both locale files; Test `partialStreaming.spec.ts`, `chatController.spec.ts`, `parser.spec.ts`, `context.spec.ts`, the three UI specs and the shared fixture `src/test/mocks/sse.ts`.

- [x] Step 1: Failing test: a stream that ends with no `finishReason` and no error must be reported as incomplete (truncated), not `done`.
- [x] Step 2: RED.
- [x] Step 3: Replace the `benignEnd` regex with an explicit classification of the end-of-stream state; keep the user-visible result (the partial text is preserved) but mark it and show a localized notice.
- [x] Step 4: GREEN plus `pnpm check:all`; add the new i18n key in both locales (coordinate with M3).

**Acceptance:** the truncated case is distinguishable from success in the data model and in the UI.

**النتيجة (2026-10-11):** نُفِّذت الخطوات 1-4. كُتب الاختبار أولًا وأُثبت RED قبل أي تعديل: `pnpm exec vitest run src/lib/chat/partialStreaming.spec.ts` -> **1 failed / 7 passed (8)**، والفشل هو العلة نفسها: بثّ يُغلق بلا `finishReason` كان يُوسم `done` (`AssertionError: expected 'done' to be 'truncated'`).

**العلة الجذرية - لا مجرد تعبير نمطي خاطئ.** كان `benignEnd` يخمّن «نهاية سليمة» من نصّ الخطأ، ولم يكن ذلك تهاونًا عرضيًا: القياس على `ai@7.0.92` يُثبت أن أي جسم بثّ ينتهي **بلا** `finishReason` يعود من الـSDK بـ`finishReason === "error"` مع `InvalidResponseDataError: Response stream ended without a finish reason.` - أي أن «إغلاقًا سليمًا» و«انقطاعًا» كانا **متطابقين** في نظر الـSDK. والسبب أن المزوّد الوهمي المشترك `src/test/mocks/sse.ts` لم يكن يرسل `finish_reason` إطلاقًا، وكذلك `close()` في `partialStreaming.spec.ts`، فكان كل بثّ في الاختبارات مقطوعًا بالتعريف. جدول القياس (ستة تركيبات، أُثبت بملفَّي تحقّق مؤقتين ثم حُذفا): `finish_reason:"stop"` -> `"stop"`؛ `"length"`/`"tool_calls"` -> `"length"`/`"tool-calls"`؛ **بلا `finish_reason` (مع `[DONE]` أو بدونه)** -> `"error"` مع `InvalidResponseDataError`؛ سبب غير معروف `"أناناس"` -> `"other"`؛ خطأ وسط البثّ (`c.error`) -> رفض الوعد مع `APICallError`.

**التصنيف الجديد.** حُذف التعبير النمطي، وصار الحكم من حالة `finishReason` وحدها: `SUCCESS_FINISH_REASONS = ["stop", "length", "tool-calls"]`، و`truncatedEnd = finishReason === "error"` محروسًا بالنوع `InvalidResponseDataError` حتى لا يُبتلع خطأ نقل حقيقي، وسبب غير معروف -> يرمي. ويُحفظ النص الجزئي في الحالتين، فالفارق في الوسم لا في المحتوى.

**حالة `truncated` مضافة طرفًا إلى طرف.** `MessageStatus`/`TurnStatus` و`DispatchStatus`، وتجميعا الدور في `chatController.ts` (`statusForOutcomes` و`finalizeCancelled`) بترتيب أسبقية `error > truncated > stopped > done`، و`reconcile.ts` عند بدء التشغيل، و`parser.ts`/`writer.ts` في الأرشيف (وبدون `TURN_STATUSES` يرمي استيراد دور مقطوع `ArchiveValidationError`)، و`isTerminal` صارت المالك الوحيد للمسند بعد أن كان مكرّرًا يدويًا في أربعة مواضع، وبوابة الإفراج عن المحاولة في `messages.ts` تُعيد استخدامها. وعرضًا: بطاقة النتيجة وبطاقة الملخّص تعرضان إشعارًا محليًا، و`StatusAnnouncer` يُعلن «انتهى التوليد مبكرًا: الرد غير مكتمل» (مفتاحان جديدان في `en.ts` و`ar.ts`، والنصّ لا يُخزَّن أبدًا - امتثالًا لقاعدة D6).

**تصحيح أدوات الاختبار** (لا يمكن فصل الإصلاح عنها): `sseResponse` صار يدفع قطعة `finish_reason:"stop"` قبل قطعة الاستخدام، و`close()` في `partialStreaming.spec.ts` مثله، وتركيبة إعادة الفتح A/B/A في `ChatScreen.spec.tsx`. والاختبار الذي كان يوثّق السلوك القديم قُلب إلى `"no finish reason: an abruptly closed stream is truncated, not done (NM-02)"`. ولاحظ أن `dispatch.spec.ts` لم يحتج تعديلًا بعد إصلاح المزوّد المشترك - عكس ما توقّعته قائمة ملفات الخطة.

**أثر جانبي مُتحقَّق منه:** `context.ts` (يستبعد ما ليس `done`) و`rag/sessionIndexer.ts` كانا أصلًا يستبعدان الصفوف غير المكتملة، فصار نصّ الدور المقطوع لا يدخل سياق الأدوار اللاحقة ولا فهرس RAG - وهذا مقصود ومُختبَر.

**التحقق:** RED كما أعلاه؛ `pnpm exec vitest run` لسبعة ملفات (context، ResultCard، SummaryCard، StatusAnnouncer، parser، chatController، parity) -> **7 ملفات، 105 اختبار PASS**؛ `pnpm typecheck` PASS و`pnpm lint` PASS؛ `pnpm check:all` -> PASS exit 0 (101 ملفًا، **1055 passed / 3 skipped** من 1058، التغطية 88.64 / 82.04 / 86.59 / 92.6، الوارد الأساسي 1,100,196 بايت من 1,200,000 والفارق 99,804، والفعلية 1,315,433 إعلامية، والقطع والأصول والتدقيق PASS)؛ `pnpm docs:numbers` و`:check` PASS.

**انحرافات وحدود مُسجَّلة:** (1) انخفضت تغطية الفروع 82.13 -> 82.04 لأن الفروع الدفاعية الجديدة (فرع `truncated` في `reconcile.ts` وفي `finalizeCancelled`) غير مغطّاة باختبار، والعتبة العامة 75 محقّقة؛ (2) نسخ تجميع الدور الأربع ما زالت مكرّرة وإن اتفقت على الأسبقية - استخراجها في مساعد واحد مرشّح تالٍ ولم يُنفَّذ هنا لإبقاء التغيير في حدّه الأدنى؛ (3) `session.md` في الأرشيف لا يرسم علامة للدور المقطوع (العلامة `⛔` محصورة بـ`error` أصلًا)، لأن `meta.json` هو الحامل المقروء آليًا والواجهة هي السطح الأساسي؛ (4) كلفة الدور المقطوع تبقى `ok` في سجل الاستخدام لأن الرموز حُوسبت فعلًا.

### T2.3 - Cost from the resolved model (NM-03)

**Files:** Modify `src/lib/chat/dispatch.ts` (the cost lookup after `result.usage`); Test `dispatch.spec.ts` (two new cases: a priced live-catalog model and an unpriced one).

- [x] Step 1: Failing test: a live-catalog OpenRouter model yields a non-null `costUSD` for a known token count.
- [x] Step 2: RED (currently null because the static registry has no entry).
- [x] Step 3: Compute from the `modelInfo` already resolved at line 107, keeping the static path as the fallback.
- [x] Step 4: GREEN plus `pnpm check:all`.

**النتيجة (2026-10-11):** نُفِّذت الخطوات 1-4. كُتب الاختبار أولًا وأُثبت RED: `pnpm exec vitest run src/lib/chat/dispatch.spec.ts` -> **1 failed / 16 passed (17)**، والفشل هو العلة نفسها: `AssertionError: expected null to be close to 0.0000017399999999999999` - أي أن سعر المزود المنشور كان مُهمَلًا تمامًا.

**العلة.** كان موضع واحد (السطر 174) يقرأ الوصف من السجل الثابت وحده: `getProvider(...).staticModels.find((m) => m.id === p.modelId)`. و`staticModels` في OpenRouter صفّان مكتوبان يدويًا (`openai/gpt-4o` و`anthropic/claude-sonnet-4.5`) فقط، فأي نموذج مضاف من الكتالوج المباشر (و`modelsSource: "live"`) لا صفّ له => `info === undefined` => `costUSD: null` رغم أن السعر منشور من المزود وواصل أصلًا في `modelInfo` المحلول.

**الإصلاح قرار واحد:** `const costModel = modelInfo.pricing ? modelInfo : staticInfo;` - الكلفة من الوصف المحلول أولًا، والسجل الثابت احتياطي حين يخلو المحلول من سعر. ولا يمكن للإصلاح أن يخترع سعرًا: `modelInfo.pricing` إما كائن أسعار منشور من المزود (`normalizeModelEntry` يرفض كل قيمة غير منتهية أو سالبة ويحوّل الغياب إلى `null`) أو غائب فيسقط إلى السجل الثابت أو إلى `null`.

**تحقّق سلسلة الوصول في الإنتاج (لا في الاختبار وحده).** الاختبار يحقن `modelInfoFor` مباشرة، فأُثبت أن السعر يصل فعلًا في التطبيق: `AddModelDialog.handlePick` يمرّر `ModelInfo` الكامل من الكتالوج -> `ChatScreen.tsx:310` (`modelInfo: { ...result.modelInfo }`) -> `db/repos/clone.ts:11-13` يستنسخ `pricing` استنساخًا عميقًا -> `chatController.ts:63-65` (`cloneModelInfo`) يحفظه -> `chatController.ts:181` يمرّره إلى `dispatchTurn`. وقائمة «الأخيرة» تحفظ الوصف كاملًا في `localStorage` وتُعيد اختياره (`AddModelDialog.tsx:135`). وأُضيف اختبار نقيض: نموذج بلا سعر منشور ولا صفّ ثابت يبقى `costUSD: null` لا صفرًا - الصفر هنا يخفي فاتورة حقيقية.

**التحقق:** RED كما أعلاه؛ `pnpm exec vitest run src/lib/chat/dispatch.spec.ts` -> **17 passed (17)**؛ `pnpm typecheck` PASS و`pnpm lint` PASS؛ `pnpm check:all` -> PASS exit 0 (101 ملفًا، **1057 passed / 3 skipped** من 1060، التغطية 88.64 / 82.07 / 86.59 / 92.6، الوارد الأساسي 1,100,212 بايت من 1,200,000 والفارق 99,788، والفعلية 1,315,449 إعلامية، والقطع والأصول والتدقيق PASS)؛ `pnpm docs:numbers` و`:check` PASS.

**ملاحظة مجاورة لم تُصلَح هنا (خارج نطاق NM-03):** `computeCost` يتحقق من سعرَي القراءة/الكتابة (`isRate`) لكنه يستعمل `inputPerMTok`/`outputPerMTok` بلا تحقق، و`getRecentModels` يقرأ `localStorage` بلا تحقق من الشكل؛ فقيمة محرّرة يدويًا هناك قد تُنتج كلفة `NaN`. الاحتمال منخفض (المصدر متصفح المستخدم نفسه)، وهو من جنس T2.9 لا NM-03، فسُجِّل ولم يُوسَّع النطاق.

### T2.4 - Record cache-write tokens (NL-01)

**Files:** Modify `src/lib/chat/dispatch.ts` (the usage block after `result.usage`, now the pure `toUsage` mapper), `src/lib/chat/chatController.ts` (the usage-event sidecar), `src/features/chat/hooks/useSummaryExtraction.ts` (the summary usage event); Test `dispatch.spec.ts` (three mapper cases), `chatController.spec.ts` (one ledger case).

- [x] Step 1: Failing test: a usage object carrying `cacheWriteTokens` produces a cost that includes the write charge and a persisted usage row that carries the count.
- [x] Step 2: RED.
- [x] Step 3: Read `cacheWriteTokens` and `noCacheTokens`, persist them, and verify against `computeCost` in `registry.ts`.
- [x] Step 4: GREEN plus `pnpm check:all`.

**النتيجة (2026-10-11):** نُفِّذت الخطوات 1-4. كُتبت الاختبارات أولًا وأُثبت RED: `pnpm exec vitest run src/lib/chat/dispatch.spec.ts src/lib/chat/chatController.spec.ts` -> **4 failed / 64 passed (68)**، وهي `TypeError: toUsage is not a function` ثلاث مرات في `dispatch.spec.ts`، و`AssertionError: expected undefined to be 40` في `chatController.spec.ts:538`.

**العلة رابطان لا رابط واحد.** (1) `dispatch.ts` كان يبني `Usage` بقراءة `cacheReadTokens` وحده ولا يقرأ `cacheWriteTokens` أبدًا. (2) `chatController.ts` (صف الاستهلاك الجانبي) و`useSummaryExtraction.ts` (حدث استهلاك الملخّص) يبنيان `UsageEvent` بحقول صريحة ولا يمرّران `cacheWriteInputTokens`، فيسقط العدد من السجل حتى لو قرأه التحويل. الطبقة الدنيا كانت جاهزة بالكامل: `Usage` و`UsageEvent` يحملان الحقل منذ المخطط v2، و`db.ts:50` يملأ الصفوف القديمة بصفر، و`computeCost` (`registry.ts:73-80`) يحسب `cacheWritePerMTok` ويعيد `null` (لا قيمة منقوصة) حين يوجد عدد كتابة بلا سعر منشور، و`modelCatalog.ts:37` يقرأ `input_cache_write`، و`writer.ts:119`/`parser.ts:146`/`recoveryUsage.ts:26` يكتبونه ويقرأونه، و`identity.ts:48` يقارنه، و`ResultCard.tsx:103`/`SummaryCard.tsx:42` يرسمانه عند وجوده؛ فلم يكن ينقص إلا الوصلان.

**قياس حاسم يقيّد الادعاء.** لا مزوّد في التطبيق يُنتج `cacheWriteTokens` اليوم: `@ai-sdk/openai-compatible` يثبّت `cacheWrite: void 0` (`dist/index.js:81`) ولا يقرأ إلا `prompt_tokens_details.cached_tokens`، و`@ai-sdk/google` يثبّت `cacheWrite: void 0` أيضًا (`dist/index.js:319,4739`). فالتقليل الصامت الذي تصفه NL-01 **كامن لا واقع** مع هذين المزوّدين، والإصلاح وصلٌ استباقي يمنع ضياع العدد لحظة أن يكشفه مزوّد أو إصدار SDK. لذلك استُخرج التحويل في دالة نقية `toUsage(u, costModel)` تُقاس مباشرة (مسار المزوّد لا يمكن أن يُنتج عددًا غير صفري)، وأُضيف اختبار طرفي للسجل يحقن ناتج إرسال بعدد كتابة 40 عبر `dispatchHook.overrideOutcomes` الموجود أصلًا في `chatController.spec.ts:227`، ويتحقق من وصوله إلى صف `usage_events`.

**`noCacheTokens` - انحراف عن صياغة الخطوة 3.** `asLanguageModelUsage` يقرأ `inputTokens: usage.inputTokens.total` (`usage.ts:85`)، أي أن `inputTokens` هو الإجمالي، و`computeCost` يشتق غير المُخزَّن بالطرح (`input - read - write`)، فإضافة حقل `noCacheTokens` مخزَّن لا تضيف معلومة وتستلزم ترقية مخطط؛ اكتُفي بالاشتقاق وسُجِّل الانحراف.

**التحقق:** RED كما أعلاه؛ ثم `pnpm exec vitest run src/lib/chat/dispatch.spec.ts src/lib/chat/chatController.spec.ts` -> **68 passed (68)**؛ `pnpm check:all` -> PASS exit 0 (101 ملفًا، **1061 passed / 3 skipped** من 1064، التغطية 88.65 / 82.02 / 86.6 / 92.61، الوارد الأساسي 1,100,383 بايت من 1,200,000 والفارق 99,617، والفعلية 1,315,620 إعلامية، والقطع والأصول والتدقيق PASS)؛ `pnpm docs:numbers` و`:check` PASS (حدّث `README.md` و`docs/environment.md`).

**انحراف مُسجَّل:** انخفضت تغطية الفروع 82.07 -> 82.02 لأن أذرع `??`/`?.` الدفاعية الجديدة في `toUsage` غير مغطّاة باختبار (كل أسطر الدالة مغطاة، والعتبة العامة 75 محقّقة). **ومرشّح تالٍ:** كاتبا صف الاستهلاك (`chatController.ts` و`useSummaryExtraction.ts`) يكرّران قائمة الحقول نفسها - توحيدهما في باني واحد من جنس توحيد نسخ تجميع الدور.

### T2.5 - One context limit (NL-02)

**Files:** Create `src/lib/chat/contextLimit.ts`; modify `src/lib/chat/dispatch.ts` (the gate's limit argument), `src/features/chat/ChatScreen.tsx` (the meter's limit), `src/features/chat/Composer.tsx` (the pass-through), `src/features/chat/ContextMeter.tsx`, `src/i18n/en.ts` + `src/i18n/ar.ts` (two keys); Test `contextLimit.spec.ts` (new), `dispatch.spec.ts`, `ChatScreen.spec.tsx`.

- [x] Step 1: Failing test: for a model with no `contextLength`, the number the meter displays equals the number the gate enforces.
- [x] Step 2: RED.
- [x] Step 3: Implement `resolveContextLimit(modelInfo)` with the fallback in one place, and have the meter, the gate and the trimming loop all read from it.
- [x] Step 4: GREEN plus `pnpm check:all`.

**النتيجة (2026-10-11):** نُفِّذت الخطوات 1-4. كُتبت الاختبارات أولًا وأُثبت RED: `pnpm exec vitest run src/lib/chat/contextLimit.spec.ts src/lib/chat/dispatch.spec.ts src/features/chat/ChatScreen.spec.tsx` -> **3 failed** (وحدتان تعذّر فيهما حلّ `./contextLimit` غير الموجود بعد، واختبار المقياس `1 failed / 45 passed` في `ChatScreen.spec.tsx`).

**التناقض ومصدره.** البوابة في `dispatch.ts` كانت تفرض `modelInfo.contextLength ?? 128000` بينما المقياس في `ChatScreen.tsx` كان يعرض «؟» للنموذج نفسه، فيُرفض السؤال محليًا بلا حركة مقياس تشرح السبب - وهذا نصّ NL-02. والمصدر أن الرقم كان مكتوبًا في موضع واحد والمقياس يجهله، لا أن أحد الطرفين خاطئ.

**قرار التصميم.** `resolveContextLimit(modelInfo)` يعيد `{ limit, assumed }` ومعه ثابت معلن `ASSUMED_CONTEXT_LIMIT = 128_000`: حد منشور صالح -> `assumed: false`، وغائب **أو مشوّه** (صفر/سالب/`NaN`/`∞`) -> الحد المفترض مع `assumed: true`. وبقيت «علامة الجهل الصادقة» للغياب الكامل: بلا هدف إطلاقًا يبقى المقياس «؟». أما الحد المفترض فنُعرضه - لأن البوابة تفرضه فعلًا - موسومًا بعلامة «~» وعنوان «الكونتيكست (حد مفترض)» عبر مفتاحَي `chat.contextAssumedMark` و`chat.contextAssumed`، فلا يُقرأ الرقم كحد منشور ولا يبقى الرفض بلا تفسير. وهذا يعكس اختبارًا كان يثبّت «؟» ويستبدله بنسبة محسوبة على الحد المفترض نفسه (`~1%` لـ 1000 من 128000).

**إصلاح مجاور كشفه الاختبار.** القيمة المشوّهة لم تكن تمرّ من `?? 128000` (لأن `NaN` ليست `null` ولا `undefined`) فتصل إلى `buildContextMessages` وترمي «حد السياق غير صالح»، أي يسقط الدور بخطأ لا علاقة له بالمزوّد. صار الحلّ يعاملها كغياب، ويثبّته اختبار «حد مشوّه لا يكسر الدور».

**ملاحظة حاسمة على الرسالة.** نص الرفض الذي يراه المستخدم لا يحمل الرقم لأن `mapProviderError` تطمس رسالة `buildContextMessages`؛ فالمقياس هو السطح الوحيد الذي يشرح الحد، وهذا ما يجعل توحيده ضرورة لا تحسينًا.

**التحقق:** RED كما أعلاه؛ ثم `pnpm exec vitest run src/lib/chat/contextLimit.spec.ts src/lib/chat/dispatch.spec.ts src/features/chat/ChatScreen.spec.tsx` -> **73 passed (73)**، و`parity.spec.ts` و`Composer.spec.tsx` و`context.spec.ts` PASS؛ `pnpm typecheck` PASS و`pnpm lint` PASS؛ `pnpm check:all` -> PASS exit 0 (102 ملفًا، **1068 passed / 3 skipped** من 1071، التغطية 88.67 / 82.06 / 86.61 / 92.62، الوارد الأساسي 1,100,787 بايت من 1,200,000 والفارق 99,213، والفعلية 1,316,024 إعلامية، والقطع والأصول والتدقيق PASS)؛ `pnpm docs:numbers` و`:check` PASS (حدّث `README.md` و`docs/environment.md`).

**انحراف مُسجَّل:** لم أُعدّل `src/lib/chat/context.ts` خلافًا لتوقّع سطر Files في الخطة: تبقى الدالة نقية تقرأ `contextLength: number`، و`dispatchTurn` يمرّر إليها ناتج `resolveContextLimit`، فيقرأ مقص السياق (السطر 30) والتحقق (السطر 10) والرسالة (السطر 14) الرقم نفسه بلا اقتران الوحدة بوصف النموذج؛ وحُوفظ على حارسها الدفاعي واختباره. **وملاحظة نطاق:** لم يُقحم الحد المفترض في موضعَي عرض مقصودين - `writer.ts` (الأرشيف الدائم) و`model-selector.tsx` (قائمة الكتالوج) - لأنهما ينقلان ما نشره المزود، وإقحام رقم مفترض هناك يخترع بيانات في أرشيف دائم.

### T2.6 - Do not spend quota re-proving a deterministic failure (NL-03)

**Files:** Modify `src/lib/providers/keyTest.ts` (the catch block at lines 80-91); Test `keyTest.spec.ts` (four cases).

- [x] Step 1: Failing test: a listing endpoint that returns a 401 body causes exactly one generation check.
- [x] Step 2: RED.
- [x] Step 3: Restrict the fallback to transport-shaped errors (as the existing comment intends) and delete the duplicate call path.
- [x] Step 4: GREEN plus `pnpm check:all`.

**النتيجة (2026-10-11):** نُفِّذت الخطوات 1-4. أُثبت RED أولًا: `pnpm exec vitest run src/lib/providers/keyTest.spec.ts` -> **2 failed / 13 passed (15)**، وكلاهما `expected [ …(3) ] to have a length of 2 but got 3`.

**العلة أوسع من صياغة الخطوة 1.** كتلة `catch` تحيط بـ`keyListingCheck` **وبنداء التوليد الاحتياطي (السطر 74) معًا**، فالاستثناء الصادر من نداء التوليد نفسه (401/429 حتمي) يعود إليها، ولأنه ليس شبكي الشكل يسقط إلى `generationCheck` ثانٍ في السطر 86 - أي نداء توليد ثانٍ يكرّر الفشل ذاته ويستهلك الحصة بلا معلومة جديدة. أما فشل القائمة المعلن (401) فيُعالج في السطر 78 ويعود بلا أي نداء توليد أصلًا، وهو ما تُثبته الآن حالة انحدار صريحة (صفر نداء توليد)؛ فصياغة الخطوة 1 تصف مسارًا سليمًا بالفعل، والمسار المعطوب هو نداء التوليد الاحتياطي. القياس قبل الإصلاح: ثلاثة نداءات (قائمة + توليدان) بدل اثنين.

**الإصلاح.** حُذف فرع التوليد الاحتياطي كاملًا وصارت `catch` سطرًا واحدًا `return { ok: false, detail: mapProviderError(e), ms: … }`: كل ما يصل إليها إما فشل شبكي على القائمة (يُبلَّغ كما هو: سطح المكتب/CORS) أو فشل حتمي من نداء التوليد نفسه، ولا شيء منهما يبرّر نداءً ثانيًا. والنداء الشبكي على القائمة كان يُعالج في فرع مستقل (السطر 82) بلا توليد، فلم تضِع سلوكية قائمة.

**تغيير سلوكي مقصود ومسجَّل:** انتهاء مهلة نداء القائمة (15 ثانية، وهو خطأ غير شبكي الشكل) كان يجرّب التوليد، وصار يُبلَّغ كما هو («انتهت المهلة أو أُلغي النداء» - لا «مفتاح غير صالح»). هذا مقصود NL-03: المهلة على القائمة ليست دليلًا على مفتاح سيئ ولا على مفتاح سليم، ونداء التوليد على الشبكة نفسها سيُرجّح الفشل ذاته بعد 30 ثانية إضافية.

**التحقق:** RED كما أعلاه؛ ثم `pnpm exec vitest run src/lib/providers/keyTest.spec.ts` -> **15 passed (15)**؛ `pnpm typecheck` PASS و`pnpm lint` PASS؛ `pnpm check:all` -> PASS exit 0 (102 ملفًا، **1072 passed / 3 skipped** من 1075، التغطية 88.73 / 82.07 / 86.61 / 92.71، الوارد الأساسي 1,100,554 بايت من 1,200,000 والفارق 99,446، والفعلية 1,315,790 إعلامية، والقطع والأصول والتدقيق PASS)؛ `pnpm docs:numbers` و`:check` PASS.

**ملاحظة جانبية:** ارتفعت تغطية الفروع 82.06 -> 82.07 لأن فرعًا دفاعيًا غير مغطّى اختفى مع الفرع المحذوف؛ والقاعدة المنتجة الوحيدة المستهلكة هي `ProviderKeyCard.tsx` وهي تقرأ `ok`/`detail` فقط، فلا تتأثر بعدد النداءات.

---

### T2.7 - Give reasoning models a visible in-progress state (LV-02)

**Files:** Modify the stream loop in `src/lib/chat/dispatch.ts`, the affordance in `src/features/chat/ResultCard.tsx`, and the live-state plumbing in `src/lib/chat/chatController.ts` + `src/features/chat/ChatScreen.tsx` + `src/types/chat.ts` + both locale files; Test `dispatch.spec.ts` (three cases) and `ResultCard.spec.tsx` (one case).

- [x] Step 1: Spike inside the task: determine where the SDK surfaces `reasoning_content` / `reasoning` (a probe on the parsed stream). If the SDK drops them, record the decision and use the provider's option or a fetch-level transform - do not guess.
- [x] Step 2: Failing test: a stream whose deltas carry only `reasoning_content` puts the target in an explicit reasoning state, and the first `content` delta clears it. A stream that reports `reasoning_tokens` without streaming them also enters the state.
- [x] Step 3: RED.
- [x] Step 4: Plumb the deltas into a state flag. Reasoning text is never appended to `msg.text` and never merged into the answer.
- [x] Step 5: Render the state through `UiText` and existing tokens only, reusing the card's in-progress affordance (no new literal, no new colour, no new spacing).
- [x] Step 6: GREEN plus `pnpm check:all`; confirm no token is double-counted in the usage row.

**النتيجة (2026-10-11):** نُفِّذت الخطوات 1-6. أُثبت RED أولًا: `pnpm exec vitest run src/lib/chat/dispatch.spec.ts src/features/chat/ResultCard.spec.tsx` -> **3 failed / 35 passed (38)**؛ ثم GREEN **38 passed (38)**.

**قياس الخطوة 1 (سبايك على البث المُحلَّل، `ai@7.0.92` + `@ai-sdk/openai-compatible@3.0.43`):** المزوّد **لا** يُسقط التفكير؛ المُسقِط هو التطبيق. المسار المتدفق: `dist/index.js:856` `const reasoningContent = delta.reasoning_content ?? delta.reasoning;` ثم `enqueueReasoningDelta` (820-837) يُصدر `reasoning-start` + `reasoning-delta`، و`enqueueTextDelta` (838-845) يُصدر `reasoning-end` قبل أول `text-delta`. وغير المتدفق: `choice.message.reasoning_content ?? reasoning` -> جزء `reasoning` (629-633). و`ai@7.0.92` يعيد الأجزاء كما هي في `fullStream` (7727-7732)، و`await result.reasoning` يعيد `[{type:"reasoning",text:"أفكر أكثر"}]`. والاستهلاك: `completion_tokens_details.reasoning_tokens` -> `usage.outputTokenDetails.reasoningTokens` (75-86). سبب أن `grep -i reasoning src` أعاد صفرًا أن `dispatch.ts` كان يقرأ `result.textStream`، وهو مُرشِّح لـ`text-delta` وحده - فلم يكن يلزم خيار مزوّد ولا تحويل على `fetch`.

**فرق جوهري مقيس أجبر على تعديل إضافي:** في `fullStream` **لا تُرمى** أخطاء منتصف البث؛ تُسلَّم كجزء `{type:"error"}` ثم يواصل البث إلى `finish` ب`finishReason: "stop"`. إهمال الجزء كان سيوسم انقطاعًا مزودًا بـ`done` - نكوص NM-02 نفسه - فالتقاطه (`rawError = part.error`) شرط لنقل القراءة من `textStream` إلى `fullStream`، والحسم النهائي يبقى في فحص `rawError` القائم. أُضيفت حالة انحدار صريحة لبثّ فيه نص ثم خطأ منتصف.

**الانحراف عن صياغة الخطوة 2 (مسجَّل):** بند «بثّ يبلّغ عن `reasoning_tokens` بلا بثّها يدخل الحالة» غير قابل للتحقيق من التبليغ نفسه: القياس يُظهر أن `usage` يصل في الجزء الأخير **بعد** انتهاء طور التفكير، فلا إشارة حيّة منه. المُنفَّذ مؤقت صمت (`REASONING_SILENCE_MS = 1500`) يدخل الحالة إذا انقضت النافذة بلا أي نص ثم يمسحها أول `text-delta`، وهو ما يغطي `step-5` (صمت ثوانٍ ثم جواب من حرفين) وأي مزوّد بطيء. البديل المرفوض: ذاكرة لكل نموذج بأنه «يبثّ رموز تفكير» - حالة دائمة مبنية على تخمين.

**تغيير سلوكي مقصود ومسجَّل:** بطاقة أي هدف تتجاوز أول دلتا نص لديه 1500 مللي ثانية تعرض «يفكّر…» بدل «يكتب…» - لا يقتصر على نماذج التفكير، لأن `usage` لا يصل أثناء الطور. النافذة ثابت واحد قابل للتعديل، والحالتان تستخدمان الأصناف والرموز نفسها (`text-xs text-sura-muted animate-pulse`).

**التحقق:** RED ثم GREEN كما أعلاه؛ `pnpm typecheck` PASS و`pnpm lint` PASS؛ ثم 6 ملفات مجاورة (`chatController`, `operationCoordinator`, `ChatScreen`, `ChatScreenOperation`, `parity`) -> **138 passed**؛ `pnpm check:all` -> PASS exit 0 (102 ملفًا، **1076 passed / 3 skipped** من 1079، التغطية 88.56 / 81.78 / 86.38 / 92.57، الوارد الأساسي 1,101,360 بايت من 1,200,000 والفارق 98,640، والفعلية 1,316,597 إعلامية، والقطع والأصول والتدقيق PASS)؛ `pnpm docs:numbers` و`:check` PASS.

**ملاحظة جانبية:** بند الخطوة 6 مُتحقَّق بالقياس: `usage.outputTokens` يشمل رموز التفكير (قياس `out: 12` مع `textTokens: 3` و`reasoningTokens: 9`)، و`toUsage` يقرأ `u.outputTokens` وحده، فلا احتساب مزدوج. والحالة للعرض الحيّ فقط (`ChatMessage.reasoning` اختياري) ولا تُحفظ في الصف الدائم. انخفضت التغطية 88.73 -> 88.56 لأن القراءة الجديدة أضافت فروعًا دفاعية (ذراع `error` مع `rawError` مضبوط سلفًا، وذراع `reasoning-end` بعد خروج الحالة) فوق خط أساس مرتفع.

### T2.8 - Fetch the OpenCode Go catalog with the provider key (LV-04)

**Files:** Modify `src/lib/providers/modelCatalog.ts` (the fetch), `src/lib/providers/registry.ts` (opencodego becomes a live, keyed catalog) and `src/types/providers.ts` (the new `catalogNeedsKey` flag), plus the caller that lists models, `src/features/chat/AddModelDialog.tsx`; Test `modelCatalog.spec.ts` (three cases) and `AddModelDialog.spec.tsx` (two cases).

- [x] Step 1: Failing test: for a provider that holds a key and is not `browserDirect`, the catalog fetch sends `Authorization: Bearer …`; for a public catalog it sends none.
- [x] Step 2: RED.
- [x] Step 3: Thread the key into `fetchModelCatalog` as a parameter (no global), then set `modelsSource: "live"` and `liveModelsUrl` for opencodego.
- [x] Step 4: Failing test: an id present only in the anonymous catalog (for example `mimo-v2-pro`) is never offered.
- [x] Step 5: GREEN plus `pnpm check:all`; record the reachable-model delta (5 -> 38) in the progress ledger. If the static list is kept instead, record that decision and the limitation explicitly.

**النتيجة (2026-10-11):** نُفِّذت الخطوات 1-5. أُثبت RED أولًا: `pnpm exec vitest run src/lib/providers/modelCatalog.spec.ts src/features/chat/AddModelDialog.spec.tsx` -> **3 failed / 16 passed (19)** (فشل الاختباران الجديدان في `modelCatalog` بخطأ «لا يوفّر قائمة موديلات مباشرة» لأن المزود كان `static`، وفشل اختبار الحوار الذي يطلب القائمة بالمفتاح)؛ ثم GREEN **19 passed (19)**.

**التصميم (مع انحراف مسجَّل):** المفتاح يُمرَّر كوسيط إلى `fetchModelCatalog(providerId, { apiKey })` — لا حالة عامة — ويُرسَل كترويسة `Authorization: Bearer` **فقط** إلى قائمة تحتاجه. الانحراف عن الصياغة الحرفية للخطوة 1: الشرط ليس `!browserDirect` بل علم صريح جديد `catalogNeedsKey?: boolean` على `ProviderConfig` (مضبوط على `true` لـopencodego وحده). السبب أن `browserDirect` يصف قابلية الوصول من المتصفح لا عمومية القائمة، وOpenRouter `browserDirect: true` **و** `keyCheckAuth: "bearer"` في الوقت نفسه، فلا أحد العلمين القائمين يعبّر عن «هذه القائمة عامة»؛ والعلم الصريح يجعل السلوك أقل صلاحية افتراضيًا (لا يُرسل مفتاح إلى قائمة لا تطلبه).

**الانحراف عن الخطوة 3 (مسجَّل):** `liveModelsUrl` لـopencodego هو `https://opencode.ai/zen/go/v1/models` — أي **نفس** `keyCheckUrl` — فالطريقان (فحص المفتاح وجلب القائمة) يستعملان النقطة ذاتها، وهذا متوقَّع لأن القائمة المصرَّحة هي نفسها قائمة الاستحقاق.

**أثر الخطوة 5 (5 -> 38):** بالمفتاح تُجلب القائمة المصرَّحة (38 معرّفًا، وكل المعرّفات الساكنة الخمسة داخلها كما يقيس LV-05) فتصبح 38 نموذجًا قابلًا للاختيار بدل 5. وبلا مفتاح **لا يُرسَل أي طلب** (يفشل `fetchModelCatalog` قبل بناء الطلب، ويحرس الحوار قبله فلا يُعرض خطأ)، فتبقى القائمة الساكنة الخمسة — وكلها مستحقة. لذلك لا يمكن أن يُعرض أي من المعرّفات السبعة غير المستحقة (kimi-k2.5، glm-5، qwen3.5-plus، mimo-v2-pro، mimo-v2-omni، hy3-preview، grok-4.5) لا بالمفتاح ولا بغيره؛ وهذا ما يثبّته اختبار الحوار بردّ مزوّد مسموم يعيد `mimo-v2-pro` والتأكد من عدم ظهوره.

**قياس مصاحب (يخصّ T2.9 وT2.5):** القائمة المباشرة لـopencodego **لا تنشر** `pricing` ولا `context_length` (مقيس في التحقق الحيّ)، فـ`normalizeModelEntry` يعطي كل صف مباشر `pricing: null` بلا `contextLength`؛ أي أن الأسعار الخمسة المكتوبة يدويًا في السجل الساكن تختفي من العرض المباشر بدل أن تُختلق، وهذا يتفق مع T2.9 (تلك الأسعار بلا مصدر منشور)، ويظهر حد السياق بعلامة «~» المفترضة من T2.5. ولم تُمرَّر ترويسة الجلسة إلى جلب القائمة: القياس الحيّ يقول إن `/models` لا يحتاجها، والمفتاح هو ما يفرق بين 45 و38.

**التحقق:** RED ثم GREEN كما أعلاه؛ `pnpm typecheck` PASS و`pnpm lint` PASS؛ الملفات المجاورة (`registry.spec.ts`, `keyTest.spec.ts`, `src/features/settings`, `Composer.spec.tsx`, `ChatScreen.spec.tsx`) PASS؛ `pnpm check:all` -> PASS exit 0 (102 ملفًا، **1081 passed / 3 skipped** من 1084، التغطية 88.58 / 81.85 / 86.39 / 92.58، الوارد الأساسي 1,101,739 بايت من 1,200,000 والفارق 98,261، والفعلية 1,316,976 إعلامية، والقطع والأصول والتدقيق PASS)؛ `pnpm docs:numbers` و`:check` PASS.

### T2.9 - Never display an unsourced price (LV-03)

**Files:** Modify `src/lib/providers/registry.ts` (the opencodego `staticModels` pricing and `contextLength`); Test `registry.spec.ts`, `dispatch.spec.ts`.

- [x] Step 1: Failing test: an OpenCode Go model whose rate cannot be attributed produces `costUSD: null` rather than a computed figure.
- [x] Step 2: RED.
- [x] Step 3: For every OpenCode Go rate, either name a published source next to it or set the pricing to `null`. `computeCost` already maps absent pricing to `null` and the UI already renders the unknown marker.
- [x] Step 4: Treat `contextLength` the same way: a value the provider does not publish is either sourced or omitted.
- [x] Step 5: GREEN plus `pnpm check:all`; confirm release gate point 7 and state the outcome in the release notes.

**النتيجة (2026-10-11):** نُفِّذت الخطوات 1-5. أُثبت RED أولًا: `pnpm exec vitest run src/lib/providers/registry.spec.ts src/lib/chat/dispatch.spec.ts` -> **2 failed / 43 passed (45)**؛ وفشل اختبار الإرسال بالقيمة المُختلقة نفسها: `expected 0.0000108 to be null` — أي (7/1e6)×0.6 + (3/1e6)×2.2 من السعر المكتوب يدويًا. ثم GREEN **45 passed (45)**.

**العلة:** المزود لا ينشر سعرًا ولا حد سياق — `/models` يعيد `id/object/created/owned_by` فقط للنماذج الـ38 المصرَّحة (مقيس 2026-10-11، وهو ما يسجّله LV-03) — ومع ذلك كانت `registry.ts` تكتب خمسة أسعار يدويًا (glm-5.3 0.6/2.2، kimi-k2.6 0.6/2.5، deepseek-v4-flash 0.1/0.4، minimax-m2.7 0.3/1.2، longcat-2.5-preview-free 0/0) وحدّ سياق لنموذج واحد (longcat 1,000,000). يمرّرها `dispatch.ts` إلى `computeCost` فيصل الرقم إلى `ResultCard.tsx` و`writer.ts` و`sessionExporter.ts` بصيغة `$0.000000`؛ فالمال المعروض لم يكن قابلًا للتتبّع إلى سعر منشور.

**التنفيذ:** كل الصفوف الخمسة صارت `pricing: null` وأُسقط `contextLength` منها. لم يُنسب أي سعر إلى مصدر منشور لأن المزود لا ينشر سعرًا أصلًا، ولم يُخترع مصدر بديل: `computeCost` يعيد `null` بلا تسعير والواجهة تعرض «—»، وحد السياق يسقط إلى `ASSUMED_CONTEXT_LIMIT = 128_000` معلَّمًا بـ«~» (T2.5) بدل رقم مُدَّعى. ملاحظتان مقصودتان: النموذج المسمّى «free» **لم** يُثبَّت سعره صفرًا (الصفر رقم كأي رقم، والاسم ليس مصدر تسعير منشورًا)، وlongcat فقد حدّه المدَّعى 1,000,000 فصار محكومًا بالحد المفترض 128k.

**تأكيد بوابة الإصدار، النقطة 7:** «لا يعرض أي مزود سعرًا بلا مصدر: كل سعر لـOpenCode Go إمّا منسوب إلى مصدر منشور أو غير معروف». صارت كل أسعار OpenCode Go **غير معروفة** (`null`)، فالنقطة 7 محقَّقة لـOpenCode Go — وهو النطاق الذي تسمّيه الخطوة 3 والنقطة 7 بين قوسين. **متبقٍّ مسجَّل لا مُصلَح:** الأسعار المكتوبة يدويًا لمزودي `google` و`minimax` (و`openrouter` كاحتياط) ما زالت بلا مصدر منسوب ولا اختبار يحرسها؛ وعنوان النقطة 7 أوسع («أي مزود») من نطاقها بين قوسين، فسُجِّل كسؤال Q7 في ملف التقدّم بدل توسيع T2.9 بصمت.

**ملاحظة على «ملاحظات الإصدار»:** لا يوجد ملف ملاحظات إصدار في المستودع بعد (T6.x/T7.2 يملكانه)، فسُجِّلت النتيجة هنا وفي سجل الأدلة بدل ادّعاء كتابتها.

**التحقق:** RED ثم GREEN كما أعلاه؛ `pnpm typecheck` PASS و`pnpm lint` PASS؛ `pnpm check:all` -> PASS exit 0 (102 ملفًا، **1083 passed / 3 skipped** من 1086، التغطية 88.58 / 81.85 / 86.39 / 92.58، الوارد الأساسي 1,101,695 بايت من 1,200,000 والفارق 98,305، والفعلية 1,316,932 إعلامية، والقطع والأصول والتدقيق PASS)؛ `pnpm docs:numbers` و`:check` PASS.

## Milestone M3 - i18n completeness (NM-04)

**Exit criteria:** the lint rule would have caught every hardcoded string found in review `4 NM-04; no user-visible string or locale-formatted value bypasses `UiText`; adding a third language still means one resource file plus one registry entry.

### T3.1 - Decide and implement the persisted-error strategy (D6)

**Files:** Modify `src/lib/db/repos/attempts.ts` (line 11), `reconcile.ts` (lines 70, 81, 96, 131) and the render sites; Test `repos.spec.ts` (assertions at lines 293, 329, 333, 711, 1237, 1291, 1292 must keep passing).

- [x] Step 1: Record the decision in ADR 0005: the stored literal stays stable; rendering maps known stored values to resource keys.
- [x] Step 2: Failing test: a message row carrying the known interrupted value renders through `t` in both locales, and an unknown stored error renders unchanged (never blank).
- [x] Step 3: Implement the map and route the render sites through it.
- [x] Step 4: GREEN; confirm `repos.spec.ts` is untouched and passing.

**النتيجة (2026-10-11):** نُفِّذت الخطوات 1-4. أُثبت RED أولًا: `pnpm exec vitest run src/features/chat/ResultCard.spec.tsx` -> **1 failed / 14 passed (15)**: الاختبار الجديد يطلب `en.errors.interruptedTurn` فمرّر `undefined` إلى `getByText` لأن البطاقة كانت تعرض النصّ العربي المخزَّن كما هو. ثم GREEN **42 passed (42)** في المجموعة المجاورة (`messageError.spec.ts`، `parity.spec.ts`، `StatusAnnouncer.spec.tsx`، `SummaryCard.spec.tsx`، `ResultCard.spec.tsx`).

**التصميم:** وحدة صغيرة `src/lib/chat/messageError.ts` تحمل خريطة «القيمة المخزَّنة -> مفتاح مورد» ودالة `messageErrorText(t, stored)`، والخريطة تُشتقّ من الثابت نفسه (`[INTERRUPTED_TURN_ERROR]: "errors.interruptedTurn"`) فلا يتكرّر النصّ العربي في ملف ثانٍ ولا تنفصل الخريطة عن الصفّ. مواضع العرض الأربعة تمرّ كلها عبرها: `ResultCard.tsx` (بطاقة النتيجة)، `SummaryCard.tsx` (الخلاصة)، `StatusAnnouncer.tsx` (قارئ الشاشة)، و`ChatScreen.tsx` (تنبيه الخطأ). ومفتاح `errors.interruptedTurn` أُضيف إلى `en.ts` و`ar.ts`، وقيمته العربية **مطابقة بايتًا** للقيمة المخزَّنة، فيثبّت اختبار أن `ar.errors.interruptedTurn === INTERRUPTED_TURN_ERROR` (لا تغيير مرئي لمستخدم العربية).

**انحراف عن سطر «Files» (مسجَّل):** لم يُلمس `attempts.ts` ولا `reconcile.ts` ولا `repos.spec.ts` — القيمة المخزَّنة تبقى بمُلك واحد، بلا هجرة وبلا تغيير مخطط. التأكيد: `git diff` بلا تغيير لهذه الملفات الثلاثة، و`pnpm exec vitest run src/lib/db/repos.spec.ts` -> **67 passed (67)** بلا تعديل أي تأكيد. والملفات المُنفَّذة فعلًا: `src/lib/chat/messageError.ts` (جديد) و`messageError.spec.ts` (جديد) و`src/i18n/{en,ar}.ts` و`src/features/chat/{ResultCard,SummaryCard,StatusAnnouncer,ChatScreen}.tsx` و`ResultCard.spec.tsx` وADR 0005.

**حدود مقصودة (مسجَّلة):** الصفّ والتصدير والأرشيف **لا تُترجَم**: `exportSessionAsJSON` تصدّر كائن الرسالة كما هو، و`writer.ts` يكتب `errors` في ملف الأرشيف كما هي، لأن الملف المكتوب بيانات قابلة للاستيراد وترجمته تُفقد التطابق مع قاعدة البيانات. وأخطاء الأدوات في `TurnView.tsx` مجال آخر (`toolErrors` بخاصية `toolName`) لا نصّ مخزَّن في صفّ رسالة، فلم تُلمس. وأُبقيت رسالة قارئ الشاشة على `chat.unknownError` عند غياب الخطأ (`last?.error ? … : t("chat.unknownError")`) فلا يصير الإعلان فارغًا.

**ADR 0005:** `docs/adr/0005-persisted-error-text-and-i18n-enforcement.md` يثبّت القرارات السبعة (أهمّها: القيمة بايتًا كما هي، الترجمة عند العرض وحده، غير المعروف يُعرض كما هو ولا يصير فارغًا أبدًا، ولا هجرة ولا مخطط جديد)، ويسجّل عمود `errorCode` كقرار مؤجَّل لا مرفوض، ويحمل قسمًا لـD5 يُكمَل في T3.2.

**التحقق:** RED ثم GREEN كما أعلاه؛ `pnpm typecheck` PASS و`pnpm lint` PASS؛ `pnpm exec vitest run src/lib/db/repos.spec.ts` -> **67 passed (67)** بلا تعديل؛ `pnpm check:all` -> PASS exit 0 (103 ملفًا، **1090 passed / 3 skipped** من 1093، التغطية 88.59 / 81.87 / 86.40 / 92.58، الوارد الأساسي 1,101,953 بايت من 1,200,000 والفارق 98,047، والفعلية 1,317,190 إعلامية، والقطع والأصول والتدقيق PASS)؛ `pnpm docs:numbers` و`:check` PASS.

### T3.2 - Enforce the rule with lint (D5)

**Files:** Modify `eslint.config.js` (the `no-restricted-syntax` block around line 32); modify `src/i18n/{en,ar}.ts` and every offending file.

- [x] Step 1: Add the selector (AST string-literal based, so Arabic comments are untouched) plus an explicit allowlist for `src/i18n/**` and `**/*.spec.ts` - and for the measured non-UI backlog (see Step 3).
- [x] Step 2: Run `pnpm lint` and collect the real violation list - this list is the NM-04 surface. Record it in the progress file. **Measured: 108 violations in 25 files, all in `src/lib/**` + `src/state/**`, classified into five classes in the progress file.**
- [ ] Step 3: RE-SCOPED by Q8 (recorded, not skipped): converting every violation to a key would change persisted bytes (contradicting ADR 0005) and model prompts, so the non-UI layer is exempted with a written reason per class and the conversion is split into `T3.2a` (stored/archived prose through the D6 render-map) and `T3.2b` (user-visible errors through a keyed error type plus one boundary translator). Model prompts stay Arabic permanently.
- [x] Step 4: `pnpm lint` PASSes with the rule enabled (`pnpm typecheck` PASS, full gate re-run for the config change: PASS exit 0).
- [x] Step 5: Write ADR 0005 covering both this rule and D6 - its D5 section now records the rule, the measured 108-site surface and the binding exemption policy.

**Acceptance:** `pnpm lint` PASSes with the rule enabled, and the rule demonstrably fails on a temporary Arabic literal. **Met:** a probe in `src/features/__probe.ts` is rejected with the rule's message while the exempt `src/lib/__probe.ts` is clean, and `pnpm lint` exits 0.

**النتيجة (2026-10-11):** نُفِّذت الخطوات 1 و2 و4 و5، ورُوعِيت الخطوة 3 بقرار مسجَّل (Q8). القاعدة في `eslint.config.js`: فُصلت قائمة الألوان عن قائمة العربية (`COLOUR_SELECTORS` / `ARABIC_SELECTORS`) لأن اسم القاعدة الواحد لا يحمل قائمتين — كتلة لاحقة تُعيد تعريف `no-restricted-syntax` تُسقط ما قبلها صامتًا. والمحدِّدات ثلاثة: `Literal` و`TemplateElement[value.raw]` و`JSXText`، فالتعليقات (ليست عقدًا في شجرة النحو) لا تُلمس بحكم التصميم.

**درس قياس مسجَّل:** الصيغة الأولى كتبت صنف المحارف بلا قوسين فلم تُطابق شيئًا وظلّ `pnpm lint` ناجحًا كذبًا. اللفّ بين `[ ]` هو ما جعلها تعمل، وأُثبت الاتجاهان بمسبار: ملف في `src/features/**` يحمل نصًّا عربيًا -> **error**، والملف نفسه في `src/lib/**` (المستثنى) -> نظيف.

**القياس:** **108 مخالفة في 25 ملفًا**، كلها في الطبقة غير المرئية؛ ولا ملف واحد في `src/features/**` أو `src/components/**`، أي أن سطح NM-04 في المكوّنات أُغلق سابقًا. والقائمة مصنَّفة في خمسة أصناف في ملف التقدّم: مطالبات النموذج 6، بيانات مخزَّنة/مؤرشفة 13، نثر تصدير Markdown 9، أخطاء ظاهرة للمستخدم 45، تشخيصات داخلية 35.

**لماذا لم تُحوَّل كلها (Q8):** ترجمة مطالبة نموذج تُغيّر ما يُقال للنموذج، وترجمة بايت مخزَّن تنقض ADR 0005 وتُبطل صفوفًا وتأكيدات قائمة. فالطبقة غير المرئية مستثناة صراحةً مع تعليل لكل صنف، وقائمة الاستثناء **لا يجوز أن تتضخّم** (ملف جديد يحتاج سببًا مسجَّلًا). والحصيلة: القاعدة فعّالة على واجهة المستخدم، والدين مقيس ومُسجَّل في `T3.2a` و`T3.2b`.

**التحقق:** `pnpm exec eslint . --format json` -> 108 قبل الاستثناء ثم المسباران؛ `pnpm lint` PASS؛ `pnpm typecheck` PASS؛ `pnpm check:all` PASS exit 0 (103 ملفًا، **1090 passed / 3 skipped** من 1093، التغطية 88.59 / 81.87 / 86.40 / 92.58، الوارد الأساسي 1,101,953 والفارق 98,047)؛ `pnpm docs:numbers` و`:check` PASS.

### T3.2a - Stored and archived Arabic prose (opened by T3.2 / Q8)

**Files:** the Class 2 sites in the progress file (`chatController.ts` `error:` fields, the `dispatch.ts` outcome `error`, `reconcile.ts:80`, the `redact.ts` markers, `sessionIndexer.ts` source, `sessionsStore.ts` title); extend `src/lib/chat/messageError.ts` and its spec.

- [x] Step 1: Extend the known-value map with the stored literals and add one resource key per known value in both locales - the Arabic value must stay byte-identical to the stored literal.
- [x] Step 2: Failing test first: each known stored value renders translated in English and unchanged in Arabic; an unknown stored value still renders unchanged.
- [x] Step 3: Route the remaining render sites (sidecar warnings, session titles, RAG source labels) through the map.
- [x] Step 4: GREEN plus `pnpm check:all`; confirm every stored assertion in `repos.spec.ts` and the archive writer stays untouched.

**Acceptance:** no stored byte changes, and every known stored value is translated at render.

**النتيجة (2026-10-11):** نُفِّذت الخطوات الأربع. RED أولًا: `pnpm exec vitest run` على خمسة ملفات (`messageError.spec.ts`، `redact.spec.ts`، `sessionsStore.spec.ts`، `sessionIndexer.spec.ts`، `chatController.spec.ts`) -> **7 failed / 86 passed (93)**؛ الاختبارات الجديدة السبعة سقطت كلها للسبب الصحيح (مفاتيح غير موجودة -> `undefined`، والسلوك القديم -> النصّ العربي المخزَّن). ثم GREEN **5 ملفات / 93 اختبارًا**.

**التصميم (وانحرافه المسجَّل عن الخطوة 3):** المبدأ: **القيمة المخزَّنة بيانات، والمنتج هو الجهة الوحيدة التي تعرف معناها**، فيكتبها بلغة الواجهة النشطة عبر `uiText.t` في موضع الإنتاج - وهي قاعدة المستودع للوحدات غير المعتمدة على React. وبقيت خريطة D6 طبقة **توافق خلفي** أُضيف إليها مفتاحا القيمتين المخزَّنتين (`تعذر حفظ النتيجة الأساسية` -> `errors.resultSaveFailed`، و`أُلغي النداء` -> `errors.callCancelled`) لتُقرأ الصفوف المكتوبة قبل هذا التغيير مترجمة. أما الخطوة 3 فلم تُنفَّذ بالخريطة عن قصد: تحذير sidecar يُخزَّن **مركّبًا** (`chatController.ts:744` يدمج تحذيرين بـ `" ؛ "`)، وخريطة القيمة الكاملة لا تستطيع ترجمة نصّ مركّب؛ وخريطة عرض على عنوان الجلسة كانت ستترجم عنوانًا كتبه المستخدم بنفس النصّ - ضرر لا يقابله نفع. فالإصلاح في موضع الإنتاج، والخريطة للقيم القديمة وحدها.

**المواضع الثلاثة عشر:** `chatController.ts:606, 636, 663` و`reconcile.ts:80` -> `errors.resultSaveFailed`؛ `dispatch.ts:246` -> `errors.callCancelled`؛ `chatController.ts:701` -> `chat.usageEventSaveFailed`؛ `:728` -> `chat.archiveFailed`؛ `sessionsStore.ts:57` -> `app.newSession`؛ `sessionIndexer.ts:37, 73` -> `sessions.untitled`؛ `redact.ts` -> `errors.redactionGeneric` / `redactionTruncated` / `redactionMarker`.

**تفصيلان بنيويان يستحقّان التسجيل:** (1) علامات `redact.ts` الثلاث كانت ثوابت على مستوى الوحدة، والثابت يُجمّد لغة العلامات عند الاستيراد؛ صارت تُقرأ وقت الاستدعاء، وبناء قائمة القواعد في كل نداء يمنع أيضًا اشتراك كائنات `RegExp` (تسرّب `lastIndex`). (2) `chat.summary.usageEventSaveFailed` رُفع إلى `chat.usageEventSaveFailed` لأن مسار الدور الأساسي ومسار الخلاصة يكتبان النصّ نفسه، فصار للقيمة مالك واحد.

**ثبات البايتات:** كل تأكيد قائم على بايت مخزَّن يمرّ كما هو في اللغة الافتراضية (العربية): `chatController.spec.ts:434`، `ChatScreen.spec.tsx:341`، `repos.spec.ts`، وعلامة `"… [مقتطع]"` في `writer.spec.ts`، و`"جلسة"` في `sessionIndexer.spec.ts:185`. وأربعة اختبارات جديدة تثبّت سلوك لغة غير العربية (علامات الحذف، وعنوان الجلسة، وعنوان مصدر RAG الافتراضي، ونصّ فشل الدور المخزَّن). والصفوف التي كُتبت بالإنجليزية **قبل** هذا التغيير تبقى كما هي: الخريطة لا تعرف إلا القيم العربية.

**التحقق:** RED ثم GREEN كما أعلاه؛ `pnpm typecheck` PASS؛ `pnpm lint` PASS؛ `pnpm check:all` PASS exit 0 (104 ملفًا، **1112 passed / 3 skipped** من 1115، التغطية 88.61 / 81.92 / 86.43 / 92.60، الوارد الأساسي 1,102,847 بايت من 1,200,000 والفارق 97,153، والفعلية 1,318,084 إعلامية)؛ `pnpm docs:numbers` و`:check` PASS.

### T3.2b - Keyed error type and the boundary translator (opened by T3.2 / Q8) - PARTIALLY_COMPLETED

**Files:** `src/lib/errors/keyedError.ts` (new), `src/i18n/UiText.ts` + `src/i18n/index.ts` (one owner for the shape of `t`), `src/lib/limits.ts` (the first converted producer), and the boundaries `ChatScreen.tsx:439`, `ProviderKeyCard`, `AddModelDialog`.

- [x] Step 1: Introduce one keyed error type (key + args) and one boundary translator that prefers the key and falls back to `error.message`, so an unknown error is never blank.
- [x] Step 2: Failing test first: a keyed error surfaces as the active locale's text at the boundary, and an unkeyed error keeps its message.
- [ ] Step 3 -> moved to `T3.2c`: convert the remaining Class 4 sites module by module.
- [ ] Step 4 -> moved to `T3.2c`: shrink the `eslint.config.js` exemption list (the exit test).

**Acceptance (this part):** the foundation exists and is proven by one converted producer plus three boundaries, and no unkeyed error changes what it displays.

**النتيجة (2026-10-11):** نُفِّذت الخطوتان 1 و2، ونُقلت 3 و4 إلى `T3.2c`. RED أولًا: `pnpm exec vitest run src/lib/errors/keyedError.spec.ts src/lib/limits.spec.ts src/features/settings/ProviderKeyCard.spec.tsx` -> **3 ملفات فاشلة، 1 failed / 9 passed (10)**: `Failed to resolve import "./keyedError"`، و`Failed to resolve import "./errors/keyedError"`، واختبار البطاقة الجديد (بقي التنبيه عربيًا بعد `uiText.setLocale("en")` بينما أُعيد رسم البطاقة كلها بالإنجليزية). ثم GREEN **7 ملفات / 105 اختبارًا**.

**التصميم:** `KeyedError.message` هو **المفتاح** لا النصّ العربي، فيبقى السجلّ وأثر الاستدعاء قابلين للبحث ولا يصيران فارغين، بينما يتبع العرض **لغة القارئ** لا لغة لحظة الرمي. و`errorText(t, error)` هو المترجم الوحيد عند الحدود: خطأ مُفتَّح -> `t(key, args)`، وإلا فالرسالة التي يحملها الخطأ (كائنًا كان أو نصًّا أو كائنًا بخاصية `message`)، والقيمة بلا نصّ تعيد `errors.unexpected` بدل `"undefined"` أو `"[object Object]"`. و**مالك واحد لشكل `t`**: انتقل `Translate` إلى `i18n/UiText.ts` وأُعيد تصديره من `messageError.ts`، فلم يتغيّر توقيع `messageErrorText`. وأول منتج محوَّل: `limitError(field, max)` يعيد `KeyedError("errors.limitExceeded", { field, max })` ونصّه العربي مطابق بايتًا للقالب القديم (تأكيدات الحقل والحدّ وطول الرسالة ≤ 120 كما هي).

**حدّ مسجَّل:** `field` نصّ مفعول يمرّره المستدعي، فيحمل لغة لحظة إنشاء الخطأ؛ أما القالب والحدّ فيتبعان لغة القارئ. و**مؤجَّل إلى `T3.2c` عن قصد:** `context.ts` لا يُحوَّل وحده لأن `keyTest.ts:21` يطابق رسالة تجاوز السياق العربية بتعبير نمطي، فيجب أن ينتقلا معًا.

### T3.2c - Class 4 module conversion + exemption shrink (opened by T3.2b)

**Files:** the Class 4 sites in the progress file: `context.ts` **with** `keyTest.ts`, `dispatch.ts`, `turnBuilder.ts`, `modelCatalog.ts`, `registry.ts`, `reindexManager.ts`, `sessionDeletion.ts`, `startupRecovery.ts`, the `chatController.ts` throws, `settingsStore.ts:124`, plus the remaining boundaries (`StartupNotice`, the `dispatch` outcome texts). Then `eslint.config.js`.

- [x] Step 1: Convert the sites module by module to `KeyedError`, adding keys to `en.ts` and `ar.ts` and updating the specs that assert the old literals (the Arabic rendering must stay byte-identical where the site was Arabic). **Done 2026-10-12 (two increments):** increment 1 keyed the domain layer (`context.ts` **with** `keyTest.ts`, `dispatch.ts`, `turnBuilder.ts`, `modelCatalog.ts`, `registry.ts`, `reindexManager.ts`); increment 2 keyed `sessionDeletion.ts`, `startupRecovery.ts`, the four `chatController.ts` throws, `sessionsStore.ts:113` and `settingsStore.ts:122/124`, routed the file-scoped `chatController.ts` notices through `uiText.t`, and translated the `Sidebar` boundary. `LogViewer` was reviewed and deliberately left as a developer log surface.
- [x] Step 2: Convert the coupled pairs together: `context.ts` + `keyTest.ts` (the Arabic regex becomes `isKeyedError` + `key`), and any producer whose consumer pattern-matches its text. **Done 2026-10-12:** `mapProviderError`'s first statement is `if (isKeyedError(e)) return uiText.t(e.key, e.args);`, ahead of the provider-text patterns that stay unchanged because they match text the **provider** sends, not text this app wrote.
- [x] Step 3: GREEN plus `pnpm check:all`. **PASS 2026-10-12 (exit 0):** 106 files, **1140 passed / 3 skipped of 1143**, coverage **88.71 / 82.12 / 86.47 / 92.65**, base entry **1,108,201** of 1,200,000 (headroom 91,799).
- [x] Step 4: Shrink the `eslint.config.js` exemption list to the files that legitimately keep Arabic, and record why it cannot shrink by file where one file mixes classes (`keyTest.ts` and `turnBuilder.ts` hold both model prompts and errors). **Done 2026-10-12 (the exit test):** `src/lib/**` and `src/state/**` are removed; the measured residue is **83 literals in 16 files**, now a per-file allowlist with a class per entry - Class 1 prompts (`synthesis.ts`, `turnBuilder.ts`, `keyTest.ts`), Class 2 stored bytes (`messageError.ts`, `attempts.ts`), Class 3 written Markdown (`sessionExporter.ts`, `writer.ts`), Class 5 diagnostics/guards (`chatController.ts`, `operationCoordinator.ts`, `usage.ts`, `archivePaths.ts`, `parser.ts`, `sink.ts`, `tauriSink.ts`, `credentialBackend.ts`, `credentialStore.ts`). `pnpm lint` PASS.

**Acceptance:** `pnpm lint` PASSes with `src/lib/**` and `src/state/**` removed, or with a per-file allowlist that only ever shrinks; and no user-visible error is Arabic-only.

**تحقّق (2026-10-12):** `pnpm lint` PASSes with a per-file allowlist and both broad globs gone, and every Class-4 producer carries an `errors.*`/`chat.*` key translated at a boundary; the Arabic still inside the allowlist is recorded by class, with `parser.ts`:304 (a recovery-report detail) kept as an explicit Class-4 candidate rather than hidden.

**Progress 2026-10-12 (PARTIALLY_COMPLETED).** The domain layer is keyed: `context.ts` **with** `keyTest.ts` as one change, plus `dispatch.ts`, `turnBuilder.ts`, `modelCatalog.ts`, `registry.ts` and `reindexManager.ts`, with 22 new `errors.*` keys in both locales and a new contract spec, `src/lib/errors/class4Producers.spec.ts` (15 tests), that pins each key, the `{max}` argument and the live-locale switch. Where a site was Arabic the `ar.ts` value is byte-identical (asserted), so the default locale sees no change and the four modified specs only swapped their assertion from the old literal to the key. RED **5 files failed, 27 failed / 45 passed (72)** -> GREEN **15 files / 207 tests**; `pnpm typecheck` + `pnpm lint` PASS; `pnpm check:all` PASS exit 0 (106 files, **1133 passed / 3 skipped** of 1136, coverage 88.63 / 81.99 / 86.47 / 92.62, base entry 1,105,913 of 1,200,000). **Still open before this task closes:** `sessionDeletion.ts` (+ its `retryable` consumer and the ChatScreen toast), `startupRecovery.ts` (+ the `StartupNotice` boundary), the four `chatController.ts` throws, `sessionsStore.ts:113`, `settingsStore.ts:122/124`, and the `StartupNotice` / `Sidebar.tsx:92` / `LogViewer.tsx:108-109` boundaries - then Step 4, the exemption shrink, which is the exit test. The exemption list is untouched: `src/lib/**` and `src/state/**` are still exempt, so the rule does not yet guard the files this step converted.

**Progress 2026-10-12 (COMPLETED - increment 2 + Step 4).** The second increment keyed the remaining Class-4 producers: the four `chatController.ts` throws on the already-created keys `errors.noValidTargets` / `errors.attemptPromptSaveFailed` / `errors.streamCardSaveFailed`, `SessionDeletionError extends KeyedError` with the three deletion keys, the four `startupRecovery.ts` notice strings through `uiText.t`, `sessionsStore.ts:113` and `settingsStore.ts:122/124`. Two couplings were found while converting and recorded instead of papered over: (1) the four throws are **swallowed** by `finalizeSetupFailure`, so the boundary that matters is its `errorText(uiText.t, error)` read, not a rejection; (2) the file's ten `warn(...)` strings and the outcome-contract text are user-visible notices, not diagnostics, so they became nine new `chat.*` keys plus the existing `common.warningSeparator`. **9 new `errors.*` keys and 9 new `chat.*` keys** in both locales, every Arabic value byte-identical to the string it replaced. RED **10 failed / 106 passed (116)** across four spec files -> GREEN; `pnpm typecheck` PASS; `pnpm lint` PASS with Step 4's 16-file allowlist; the full gate PASS exit 0.

### T3.3 - Stop hardcoding the archive locale

**الملفات:** `src/lib/markdown/writer.ts` (السطر 384 سابقًا)، `src/lib/markdown/writer.spec.ts`.

- [x] Step 1: Failing test: the archive timestamp follows the active locale (and the formatter the app already uses), not a fixed `"ar"`.
- [x] Step 2: RED - `pnpm exec vitest run src/lib/markdown/writer.spec.ts` -> **1 failed / 21 passed (22)**.
- [x] Step 3: Route it through the app formatter, taking the locale from one place (`uiText.formatDate` + one format constant).
- [x] Step 4: GREEN (**22 passed**) plus `pnpm check:all` PASS exit 0; `pnpm docs:numbers` regenerated.

**النتيجة (2026-10-11):** نُفِّذت الخطوات الأربع. RED أولًا: `pnpm exec vitest run src/lib/markdown/writer.spec.ts` -> **1 failed / 21 passed (22)** - الاختبار الإنجليزي الجديد يسقط لأن `session.md` كان يكتب `toLocaleString("ar")` الثابتة حتى لمن اختار الإنجليزية. ثم GREEN **22 passed (22)**.

**التصميم:** `renderSessionMarkdown` يقرأ الطابع من مُنسِّق التطبيق الواحد: `uiText.formatDate(turn.createdAt, ARCHIVE_TIMESTAMP_FORMAT)`. والثابت `ARCHIVE_TIMESTAMP_FORMAT = { dateStyle: "short", timeStyle: "medium" }` يملك **الشكل** وحده، أما **اللغة** فمن `uiText` وحده. والاختياران ليسا اعتباطيين: هما الصيغة الصريحة لما كان `toLocaleString` ينتجه ضمنًا، فالنصّ العربي مطابق بايتًا لما كان يُكتب قبل التغيير (قيس في الجلسة: `"5‏/9‏/2026، 1:01:00 م"` من الطريقين معًا).

**حدود مسجَّلة:** الطابع يُلتقط عند الكتابة، فيتبع الأرشيف اللغة النشطة وقت الأرشفة لا لغة القارئ لاحقًا - وهذا هو المطلوب (D3). و`parser.ts:199` يُعيد كتابة `session.md` عند الاستيراد/التعافي فيأخذ لغة الإقلاع نفسها، ولا أحد يقرأ الطابع عند الاستيراد: `parser.ts` يقرأ `turn.createdAt` من مخطط JSON، و`sessionExporter` يكتب ISO-8601 مستقلًا عن اللغة - فلا مسار استيراد يعتمد على الشكل المعروض. ونثر التصدير (`sessionExporter.ts:25-42`) يبقى عربيًا كما هو: هو Class 3 في T3.2 وتحويله قرار مستقل.

**التحقق:** RED ثم GREEN كما أعلاه؛ `pnpm typecheck` PASS؛ `pnpm lint` PASS؛ `pnpm check:all` PASS exit 0 (103 ملفًا، **1092 passed / 3 skipped** من 1095، التغطية 88.59 / 81.87 / 86.40 / 92.59، الوارد الأساسي 1,101,985 بايت من 1,200,000 والفارق 98,015، والفعلية 1,317,222 إعلامية)؛ `pnpm docs:numbers` و`:check` PASS.
---

### T3.4 - One formatter for tokens and cost (LV-07)

**الملفات:** جديد `src/lib/usage/cost.ts` و`cost.spec.ts`؛ تعديل `ResultCard.tsx` (106، و52 لتسمية المزوّد) و`SummaryCard.tsx` (43) و`src/lib/markdown/writer.ts` (174) و`src/lib/export/sessionExporter.ts` (40) و`src/i18n/{en,ar}.ts` (المفتاح `common.noValue`)؛ مواصفات `cost.spec.ts` و`ResultCard.spec.tsx` و`writer.spec.ts` و`sessionExporter.spec.ts`.

- [x] Step 1: Failing test: the card and the export both obtain the cost string from one helper; an unknown cost renders the same marker in every site (measured: **four**, not three - `SummaryCard.tsx` was the missing one).
- [x] Step 2: RED - `pnpm exec vitest run` on the four specs -> **4 failed (4)**, `@/lib/usage/cost` unresolvable.
- [x] Step 3: Added `common.noValue` to both locales and `src/lib/usage/cost.ts`; the card formats through `uiText.formatNumber` and the archive keeps `stableCostNumber`, so the archive bytes stay predictable while the UI follows the locale. The card formats through `formatNumber`; the Markdown archive keeps a locale-stable representation but reuses the same helper and the same unknown marker, so the archive's bytes stay predictable.
- [x] Step 4: GREEN (**1105 passed / 3 skipped** of 1108) plus `pnpm check:all` PASS exit 0; `parity.spec.ts` green; no `"$"` or `"—"` left in `src/features/**`.

**النتيجة (2026-10-11):** نُفِّذت الخطوات الأربع. RED أولًا: `pnpm exec vitest run` على المواصفات الأربع -> **4 failed (4)** لأن `src/lib/usage/cost.ts` غير موجود (استيراد مفقود في المواصفات الثلاث القائمة والمواصفة الجديدة). ثم GREEN: **6 ملفات / 71 اختبارًا** بعد الإضافة، ومنها `parity.spec.ts`.

**القياس خالف الخطة:** قالت الخطة «ثلاثة مواضع»، والقياس وجد **أربعة**: `ResultCard.tsx:106` و`SummaryCard.tsx:43` (بطاقة الخلاصة، ولم تكن في LV-07) و`writer.ts:174` و`sessionExporter.ts:40`. الأربعة الآن تمرّ عبر `formatCost` وحده. وانضمّ إليها موضع خامس من العائلة نفسها: `ResultCard.tsx:52` كان يعرض `"—"` مكتوبة لتسمية مزوّد مجهولة.

**التصميم:** `src/lib/usage/cost.ts` يملك **الشكل** وحده: `CURRENCY_MARK = "$"` و`COST_DECIMALS = 6` و`UNKNOWN_COST = "—"` ومنسّق أرقام افتراضي **ثابت** (`stableCostNumber` = `toFixed(6)`) للأرشيف والتصدير. أما **التنسيق** فيُمرَّر: الواجهة تمرّر `uiText.formatNumber` فتتبع اللغة، والأرشيف يبقى ثابت البايتات. والعلامة المجهولة مورد واحد: `common.noValue` في اللغتين، و`cost.spec.ts` يثبّت `en.common.noValue === ar.common.noValue === UNKNOWN_COST` فلا ينزلق الاثنان أبدًا. والصفر سعر حقيقي: `formatCost(0)` -> `$0.000000` لا العلامة المجهولة، فيحرس قرار T2.3 (المجهول `null` لا `0`).

**التحقق:** RED ثم GREEN كما أعلاه؛ `pnpm typecheck` PASS؛ `pnpm lint` PASS؛ `pnpm check:all` PASS exit 0 (104 ملفات، **1105 passed / 3 skipped** من 1108، التغطية 88.61 / 81.91 / 86.42 / 92.60، الوارد الأساسي 1,102,173 بايت من 1,200,000 والفارق 97,827، والفعلية 1,317,410 إعلامية)؛ `pnpm docs:numbers` و`:check` PASS. وفحص الخطوة 4: لا يبقى في `src/features/**` أي `"—"` ولا `"$"` مكتوب.
## Milestone M4 - Architecture and maintainability

### T4.1 - Extract `persistTurn` out of `ChatScreen.tsx`

**Files:** Create `src/features/chat/persistTurn.ts`; modify `src/features/chat/ChatScreen.tsx` (the large closure); Test a new `persistTurn.spec.ts`.

- [x] Step 1: Write characterisation tests against the current behaviour first (the predicates: operation current, live view, canonical assistant message, warning visibility, callback acceptance, retry-source reconstruction) so the extraction cannot silently change semantics. **RED 2026-10-12:** `pnpm exec vitest run src/features/chat/persistTurn.spec.ts` -> **1 failed suite, 0 tests**, `Failed to resolve import "./persistTurn"`. The same line proved the two screen specs green **before** the move: `ChatScreen.spec.tsx` (46 tests) and `ChatScreenOperation.spec.tsx` (21 tests).
- [x] Step 2: Move the logic behind an explicit dependency object (stores, db, archive sink, clock) and have `ChatScreen` call it. No behaviour change in this task. **Done 2026-10-12:** 1-based lines 171-454 moved **verbatim** under `const { ... } = deps;`, so no body line was rewritten and the two are diffable; the **sixteen** closure values travel on `PersistTurnDeps` (`session`, `sessionId`, `t`, `plural`, `targets`, `syncMode`, `providerKeys`, `timeoutMs`, `contextMode`, `multiStepTools`, `upsertMessagesLocal`, `setToolErrors`, `setToolActivity`, `aborts`, `stopped`, `viewGenerationRef`) while the db/store/coordinator/archive singletons stay module imports. One dependency was **not** in this step's list: `setToolActivity`, read by the tool-execution callbacks - `tsc` refuses the extraction without it.
- [x] Step 3: `pnpm test` must be green with no test edits other than the new spec, and `ChatScreen.tsx` must drop below 400 lines. **PASS 2026-10-12:** `ChatScreen.tsx` **603 -> 315 lines** (target: under 400) and `persistTurn.ts` is 332 lines; the new spec is 11 tests and **no existing test file was edited** - `ChatScreen.spec.tsx` (46) and `ChatScreenOperation.spec.tsx` (21) pass **unchanged**, which is what makes "no behaviour change" checkable rather than claimed.
- [x] Step 4: `pnpm check:all`. **PASS 2026-10-12 (exit 0):** 107 files, **1151 passed / 3 skipped of 1154**, coverage **88.75 / 82.23 / 86.48 / 92.65**, base entry **1,108,660** of 1,200,000 (headroom 91,340; eager 1,323,897 informational). `pnpm docs:numbers` + `:check` PASS.

**Acceptance:** `persistTurn` is unit-tested without rendering; `ChatScreen` shrinks by the extracted amount. **Met:** the unit spec drives the send and the retry paths through injected refs and mocks only `@/lib/chat/chatController` + `@/lib/db/repos` (no React render, no Dexie), and `ChatScreen.tsx` lost 288 lines into a 332-line module.

**Progress 2026-10-12 (COMPLETED).** The characterisation spec pins the six predicates this step named: a cancelled operation accepts no callback at all (`onDelta`/`onStatus`/`onAppended` dropped, nothing published, nothing written) and its lease is released as `cancelled`; a stale view still publishes to the coordinator and skips the store on **both** guards (`currentId` and `viewGenerationRef`); every identity dimension rejects a mismatch while the exact one passes (`operationId`, `attemptId`, `turnId`, `messageId`, `targetId`); a non-canonical row never reaches the store; a warning is toasted only for the latest operation in a live view; and `onStatus`'s error is read through the stored-value map (`errors.interruptedTurn`) instead of printed raw, with a `KeyedError("errors.noValidTargets")` in the send path surfacing as translated text and never as the raw key. Both retry-source branches are pinned: a persisted attempt is the stable source with no re-save, and a missing record rebuilds the legacy attempt (`legacy-<turnId>`, `attempt: 0`, `sourceMessageId`, the shared + marker + custom `promptText`) and persists it **before** sending, while an invalid record throws and toasts instead of sending. **The one measured cost is the module boundary itself:** base entry 1,108,201 -> **1,108,660** bytes (+459) and eager 1,323,441 -> 1,323,897 (+456), still inside D7 with 91,340 headroom. **Next:** T4.2 (the optional 500-line guard; decide in-task).

### T4.2 - Guard against the file growing back (decided and shipped in-task)

- [x] Step 1: If agreed, add a test asserting that no file under `src/features/chat/` exceeds 500 lines, with a clear failure message. **Shipped 2026-10-12 as `src/features/chat/fileBudget.spec.ts` (2 tests).** RED first with the *literal* rule (500 for every file): `pnpm exec vitest run src/features/chat/fileBudget.spec.ts` -> **1 failed / 1 passed (2)**, naming exactly three files - `ChatScreen.spec.tsx` **1435**, `ChatScreenOperation.spec.tsx` **583**, `hooks/useSummaryExtraction.ts` **535**. **Decision:** keep **500 as the default for production modules**, give **specs 600**, and record the offenders as explicit **ceilings** (`ChatScreen.tsx` **400** - T4.1's own acceptance number, so the extracted screen cannot grow back from 315; `hooks/useSummaryExtraction.ts` **550**; `ChatScreen.spec.tsx` **1450**, each measured + a small margin so a one-line edit does not break the build). The ceilings may only shrink, and raising one requires a decision recorded in the progress file. GREEN **2 passed (2)**.
- [x] Step 2: If a line-budget test is rejected, record the decision and the alternative (review cadence) in the progress file instead. **Not triggered:** the test was accepted, so this step is satisfied by Step 1's recorded decision rather than by a rejection. The guard is proven both ways instead of decorative: its second test drives the default budget, the spec budget and the explicit ceiling with synthetic entries (501/601/401 lines), and lowering `ChatScreen.tsx`'s ceiling to 300 made the **real** scan fail with `ChatScreen.tsx: 315 lines (budget 300)` before it was restored to 400.

**Progress 2026-10-12 (COMPLETED).** One spec and no production code: `src/features/chat/fileBudget.spec.ts` walks `src/features/chat/**` with `node:fs` and fails with the file, its line count and its budget. The counting rule is pinned in the file's own comment (`split(/\r?\n/).length`, the measure the session's tooling reports) so the guard and the documentation cannot drift. **Recorded limitation:** the guard bounds file **size**, not structure - `ChatScreen.spec.tsx` at 1435 lines stays the largest file in the feature and splitting it is deliberately out of scope (the ceiling stops it growing; it does not make it smaller), and `hooks/useSummaryExtraction.ts` (535) is the one production module above the default budget.

---

## Milestone M5 - Accessibility hardening

**Exit criteria:** the automated pass covers every screen and state, contrast is asserted numerically, and the human-verified pass is recorded.

### T5.1 - axe across screens and states

**Files:** Modify `e2e/*`; add a new spec if needed.

- [x] Step 1: Extend the axe run to the empty state, the streaming state, the error/truncated state, the RAG/settings panes and the export dialog (today it covers the chat screen and the settings dialog only).
- [x] Step 2: Run `pnpm test:e2e:browser`; fix every serious/critical violation found, or record an accepted exception with a reason.
- [x] Step 3: Re-run and record the outputs.

- **Progress 2026-10-12 (COMPLETED).** The single chat/settings axe test is now `e2e/axe.spec.ts` (8 tests): the first-run empty state, the empty transcript, the settings dialog, the three RAG panes, a streaming answer, a provider-error card, a truncated answer, the export dialog, and the two danger states measured again under the **light** theme. Shared boot/selector setup moved to `e2e/app-helpers.ts` (and gained a `theme` option), and the mock provider gained `status`/`truncate` plans so the error and truncated states are reachable through the real UI. `test.use({ reducedMotion: "reduce" })` makes each measurement the resting state, which also removes Sonner's entrance fade from the sample.
- **Step 2 findings - five rules in three states, all fixed in production code (nothing filtered):** (1) the expanded RAG panes exposed **nine unnamed controls** - `select-name` critical x5, `label` critical on three range inputs, `button-name` critical on the auto-reindex switch; `RagSettings.tsx` now gives every one a name (`aria-label` from existing `rag.*` keys, and `htmlFor`/`id` pairs for the sliders). (2) a streaming answer failed `color-contrast` serious at **4.12:1**: the destructive hover was a **90%-alpha** fill, which composited to `#cc4342` over the dark surface and dropped the dark label below the 4.5:1 floor; `--sura-error-secondary` was added to `colors.css` (light 0.48, dark 0.70 - the same brighter-in-dark polarity `--sura-accent-secondary` uses) and `button.tsx`/`badge.tsx` hover on it instead, measuring **6.8:1** in both themes. (3) the error toast failed at **4.34:1** because `<Toaster richColors>` fell back to **Sonner's light palette** inside the dark app; `main.tsx` now maps Sonner's `--normal-*`/`--error-*`/`--success-*`/`--warning-*`/`--info-*` variables onto the app tokens, so a toast follows the active theme and reuses the danger pair `Sidebar`/`Badge` already use (5.36:1 dark, 4.99:1 light).
- **Step 3 evidence:** `pnpm test:e2e:browser` **20 passed** (12 `app.spec.ts` + 8 `axe.spec.ts`); `pnpm check:all` PASS exit 0 (108 files, **1153 passed / 3 skipped of 1156**, coverage **88.75 / 82.23 / 86.48 / 92.65**, base entry **1,109,635** of 1,200,000 headroom 90,365 - the toast/token edits cost +975 B); `pnpm docs:numbers` + `:check` PASS. Recorded observation, not fixed: `src/components/ui/sonner.tsx` is dead code whose `var(--popover)`/`var(--border)` references are Tailwind theme entries, not emitted custom properties, so importing it would break the toaster - a candidate for a small maintainability task.

### T5.2 - Assert token contrast in a unit test

**Files:** Create `src/styles/tokens/contrast.spec.ts` (or `src/lib/design/contrast.spec.ts`); possibly modify `src/styles/tokens/*.css`.

- [x] Step 1: Write the test: parse `src/styles/tokens/*.css`, and for every defined foreground/background pair actually used together compute the WCAG ratio; fail below 4.5:1 for body text and 3:1 for large text and UI boundaries. **Done 2026-10-12 as `src/styles/tokens/contrast.spec.ts` (5 tests).** It parses all nine token files, resolves `var()` chains, converts OKLCH to sRGB (alpha composited in gamma space) and applies the WCAG 2 relative-luminance ratio. The contract pins **47 pairs** in both themes - 42 body-text pairs at 4.5:1 and 5 non-text indicators at 3:1 - and four more tests hold it: a `toBeCloseTo` reproduction of the four ratios axe measured in T5.1, a completeness scan over every text/background pair a component writes in one class list, a guard that every `var(--sura-*)` a component reads is defined by a token file, and a table that gives every colour token in `colors.css` a row or a written `EXEMPT` reason. RED first: **2 failed / 3 passed (5)** - the definition guard named all eight offenders across seven files and the pair scan named the two `--sura-surface-subtle` pairs.
- [x] Step 2: If a pair fails, fix the token (not the component) and record which token changed and why. **No text pair failed, so no colour value was changed.** The lowest of the 42 body pairs is light `success on success-muted` **4.63:1** (then `accent-primary on accent-muted` 4.68, `warning on warning-muted` 4.78, `info on info-muted` 4.83, `error-foreground on error` 4.86 in dark); the tightest pair a component actually renders is light `error-text` on its own 10% tint over `chat-assistant-bg` at **4.62:1**, pinned in the table with that backdrop. What failed was **token plumbing**, and both defects were fixed at the reference rather than by adding a sixth surface token or an alias: `--sura-surface-subtle` (`ShortcutHelpDialog.tsx:26`) now reads `--sura-surface-secondary`, and `--sura-border-width-focus` (six components plus `globals.css:130`) now reads `--sura-border-width-emphasis`. One variable, one owner.
- [x] Step 3: `pnpm test` green. **PASS:** `pnpm exec vitest run src/styles/tokens/contrast.spec.ts` **5 passed (5)**; `pnpm typecheck` PASS; `pnpm exec eslint` on the nine changed files PASS; `pnpm test:e2e:browser` **22 passed**; `pnpm check:all` PASS exit 0 (109 files, **1158 passed / 3 skipped of 1161**, coverage **88.75 / 82.23 / 86.48 / 92.65**, base entry **1,109,656** of 1,200,000, headroom 90,344); `pnpm docs:numbers` + `:check` PASS.

- **Progress 2026-10-12 (COMPLETED).** One new unit spec, one new E2E guard and eight one-line token-reference fixes. `src/styles/tokens/contrast.spec.ts` (5 tests) is the numeric half: it parses the nine token files (comments stripped, `:root` -> light, `.dark` -> dark), resolves `var()` chains, converts OKLCH to sRGB with alpha composited in gamma space, and asserts **47 pairs** in both themes - **42 body-text pairs at 4.5:1** and **5 non-text indicators at 3:1** (the field focus border, the accent border on two surfaces, the invalid-state border on two surfaces). Four further tests keep the table honest: a `toBeCloseTo` reproduction of the four ratios axe measured in T5.1 (6.83 / 6.80 and 4.99 / 5.36 - measured again here from the token values alone), a completeness scan that fails when a component writes a text/background pair that has no row, a definition guard that fails when any `var(--sura-*)` a component reads is defined by no token file, and a coverage guard that requires every colour token in `colors.css` to have either a row or a written `EXEMPT` reason (13 tokens are exempted, each with its reason: decorative 1px dividers, the modal scrim, scrollbar parts, and four unreferenced tokens).
- **The guard found two defects that axe, the type checker and every existing test had missed.**
  1. **HIGH - `--sura-border-width-focus` was defined nowhere while seven places read it, and it disabled the app's only focus indicator.** `globals.css:130` paints `:focus-visible { outline: var(--sura-border-width-focus) solid var(--sura-accent-primary) }`; with the token undefined the shorthand is invalid at computed-value time, so the outline computed to `none 3px` - measured in the built app on every focused element, before the fix. **Keyboard focus was invisible app-wide** (WCAG 2.4.7 "Focus Visible", Level AA), which no contrast or axe rule can see. Repointed to `--sura-border-width-emphasis` (2px in `shapes.css:16`, the token whose comment already reads "focus ring, blockquote rule"), the fix was rebuilt, and the same probe then measured `outline: solid 2px oklch(0.7 0.15 165)` on every focused element. No colour value changed, so this is a plumbing fix rather than a redesign.
  2. **MEDIUM - `--sura-surface-subtle` was referenced once and defined nowhere**, so the shortcut help's `<kbd>` key background never painted. Repointed to the existing `--sura-surface-secondary` (text-primary on it measures 16.12:1 light / 14.74:1 dark).
- **Q9 - new finding, deliberately not fixed here because it is a visual decision.** The six components and `Composer.tsx` carry `focus-visible:ring-[var(--sura-border-width-emphasis)]` **as their ring width**, but the compiled stylesheet shows Tailwind resolved that ambiguous `var()` as a ring **colour**: `.focus-visible\:ring-\[var\(--sura-border-width-emphasis\)\]:focus-visible{--tw-ring-color:var(--sura-border-width-emphasis)}` in `dist/assets/index-*.css`. The width is therefore never set (`--tw-ring-shadow` stays at its registered initial `0 0 #0000`), no ring renders, and the accompanying `ring-offset-2` paints its 2px offset ring in the surface colour, i.e. invisibly; the same ambiguity makes `aria-invalid:ring-[var(--sura-error)]/20` inert, though the invalid **border** still renders so the state is not lost. Nothing regressed visually at any point because the ring never rendered, and the global outline is now the single indicator. Two fixes exist: write the width as `ring-[length:var(--sura-border-width-emphasis)]` (restores the ring, but then ring **and** outline both paint - a double indicator the app has never shown) or delete the dead ring/offset bundles and keep the global outline as the one owner. Left to the user as **Q9**. **RESOLVED 2026-10-12 - option B, the user's choice of the recommendation.** The recipe was deleted from all six components. **The finding above was incomplete, and measuring the deletion corrected it:** only the ring *width* was dead. The `ring-offset-2` pair painted a real 2px band, and because it named `--sura-surface-primary` (`oklch(0.16 0.02 260)` dark) while all seven sampled focused inputs sit on `--sura-surface-elevated` (`oklch(0.22 0.02 260)`), the band was a **visible wrong-colour halo on focused inputs** rather than the invisible no-op this bullet assumed. Deleting the bundle is therefore a cosmetic fix, not a no-op; the offset pair can be restored in one line if the halo is wanted. Proof method: a temporary probe measured both builds - the pre-deletion build was reconstructed by re-inserting the recorded class tokens, then reverted - keyed by absolute DOM index (286 elements both runs, 68 shared); the only computed difference was the focused inputs' `box-shadow` ring slot (`0 0 0 2px` band present -> absent), with every `outline` unchanged. `button.tsx` carries the reasoning as a `[Q9]` comment.
- **Behavioural guard added:** `e2e/focus.spec.ts` (2 tests, dark and light) tabs through the first eight stops and fails when a `:focus-visible` element has no solid outline of at least 2px - the requirement axe cannot check, and the check that fails on the pre-fix build.
- **Evidence:** `pnpm exec vitest run src/styles/tokens/contrast.spec.ts` **5 passed (5)**; `pnpm typecheck` PASS (both projects); `pnpm exec eslint` on the nine changed files PASS; `pnpm exec playwright test --project=browser e2e/focus.spec.ts` **2 passed**; `pnpm test:e2e:browser` **22 passed (48.6s)**; `pnpm check:all` PASS exit 0 (109 files, **1158 passed / 3 skipped of 1161**, coverage **88.75 / 82.23 / 86.48 / 92.65**, base entry **1,109,656** of 1,200,000, headroom 90,344 - the five changed class strings cost +21 B; eager 1,324,893 informational); `pnpm docs:numbers` + `pnpm docs:numbers:check` PASS. **Next:** `T5.3`, the human-verified pass - BLOCKED without a human at a GUI.


### T5.3 - Human-verified pass (screen reader, zoom, reduced motion)

**Files:** Modify `docs/release-checklist.md` (created in T6.8) or add `docs/accessibility-manual-pass.md`.

- [x] Step 1: Write the checklist: keyboard-only journey end to end, Narrator or NVDA read-through of the transcript and settings, 200 percent zoom / 320 px reflow, `prefers-reduced-motion` honoured, RTL and LTR mixed content. **Done 2026-10-12 as `docs/accessibility-manual-pass.md`:** six recording sections (keyboard journey K1-K11, screen-reader script S1-S9, text scaling and reflow Z1-Z5, reduced motion R1-R3, RTL/LTR D1-D5, and a sign-off table), a build-hash header, the preconditions for a fresh-state run, the automated baseline it must not repeat, and the two findings already recorded. Writing it meant measuring the app, which found and fixed **T5.3-f1** (below).
- [ ] Step 2: Run it on the packaged build and record PASS/FAIL per line with the build hash. This is a human gate - mark it BLOCKED if no human is available rather than claiming it. **BLOCKED - no human at a GUI.** The automated proxy for the reflow area of this step is now permanent (`e2e/reflow.spec.ts`, 2 tests), but the screen-reader, 200%-zoom, reduced-motion and RTL/LTR lines still need a person and a packaged build. Nothing here is claimed as run.
- [ ] Step 3: File every failure as a task in this milestone and fix it before release. **One failure found before the pass even started and already fixed (T5.3-f1); the table stays open for the human run.**

- **Progress 2026-10-12 (Step 1 COMPLETED, Step 2 BLOCKED).** The checklist is `docs/accessibility-manual-pass.md`: 33 numbered checks in five sections plus the sign-off table, each line recording PASS/FAIL/N-A with evidence. It starts from the automated baseline (axe 8 states x 2 themes, 47 contrast pairs, the focus-outline guard and the new reflow guard) so the human does not repeat what a machine already measures, and it lists what a machine cannot: whether an announcement is understandable, whether tab order matches Arabic reading order, whether text scaling keeps a screen usable, and whether the language switch changes the announced voice.
- **The measurement the checklist forced found one real defect - T5.3-f1 (MEDIUM, WCAG 1.4.10 Reflow) - now fixed.** A temporary Playwright probe measured every screen at 320x720 (the width 1.4.10 names, i.e. 400% zoom on a 1280px desktop): the document never scrolled sideways (`scrollWidth == viewport` for the transcript, the mobile navigation and the shortcut dialog), but the settings dialog held **406px of content in a 318px client box and scrolled horizontally** - 19 interactive controls, including both mode switches, sat outside the viewport. The cause was isolated by elimination inside the page: the primary-model row measured a **358px min-content** (two native `<select>` elements cannot shrink below their widest option) and hiding that one row dropped the dialog to 318px, while hiding any other row changed nothing; adding `flex-wrap` to that row measured 318px with no other change. The fix is that one utility in `src/features/settings/SettingsScreen.tsx` (no value, no new token, no change above ~420px) and the permanent guard is `e2e/reflow.spec.ts` (2 tests: the transcript and both dialogs), which was **RED (1 failed / 1 passed)** before the fix and **GREEN (2 passed)** after it.
- **Step 2 stays BLOCKED and Step 3 stays open:** the screen-reader read-through, 200% zoom and text-only resize by hand, reduced motion with the OS setting off, and RTL/LTR mixed content all need a human at a GUI on the packaged build. The sign-off table is empty on purpose.
- **T5.3-f2 (LOW, best practice) - FIXED 2026-10-12.** The first-run screen had no `main` landmark: `<main>` existed only in `ChatScreen.tsx:240,248`, and the empty state rendered inside `div#main-content` (the skip link's target, but a plain `div`). Axe misses it because `landmark-one-main` is a best-practice rule and the matrix fails only on serious/critical. Fixed by rendering the empty state's block as `<main>` in `src/App.tsx` (the branches are exclusive, so two mains never coexist) and asserted in `src/App.smoke.spec.tsx` (RED -> GREEN 2 passed).
- **Evidence:** `e2e/reflow.spec.ts` RED **1 failed / 1 passed** -> GREEN **2 passed**; `pnpm build` exit 0; `pnpm exec eslint src/features/settings/SettingsScreen.tsx` PASS; `pnpm exec vitest run src/features/settings` **37 passed (5 files)**.

---

## Milestone M6 - Packaging, desktop verification and release

### T6.1 - Make the desktop E2E project green

**Files:** Modify `e2e/*`, `playwright.config.ts`, `.github/workflows/ci.yml`.

- [x] Step 1: Run `pnpm test:e2e:tauri` with the `@srsholmes/tauri-playwright` fixture and record the actual failure. **Measured 2026-10-12: 4 failed.** All four die in the fixture before touching the app: `Error: Socket /tmp/tauri-playwright.sock did not appear within 30000ms` (`TauriProcessManager.waitForSocket`, dist/index.js:1638). The 30 s is spent waiting for a socket *file* that the Windows plugin never creates: with the app started as `pnpm tauri:dev:e2e` (compiles `--features e2e-testing` and launches `target\\debug\\app.exe` in 1m01s) the plugin logs `tauri-plugin-playwright: listening on tcp://127.0.0.1:6274` and `http server on http://127.0.0.1:6275`. The app and the bridge are fine; the fixture launch wiring is the gap.
- [x] Step 2: Fix the fixture/launch wiring until the desktop suite is green, or record precisely what is missing. **PARTIALLY COMPLETED 2026-10-12.** Landed and verified: the desktop project is scoped by `testMatch: 'tauri-app.spec.ts'` instead of relying on `testIgnore: 'app.spec.ts'`; `pnpm exec playwright test --project=tauri --list` now collects exactly its 4 tests (before, it also re-ran 12 browser-mode specs, burying the real failures under 13 unrelated passes), bare `pnpm test:e2e --list` collects 28 with no duplicates, and `tsc --noEmit -p tsconfig.node.json` + `eslint playwright.config.ts` PASS. Diagnosed, not yet wired: the library connects over a Unix socket **file** (`config.mcpSocket ?? '/tmp/tauri-playwright.sock'`) and only learns the plugin TCP port when **it** spawns the app (`config.tauriCommand` -> parses `listening on tcp://127.0.0.1:<port>` from the process output, dist/index.js:1576-1624); the fixture supplies only `mcpSocket`, so on Windows it waits for a file that never appears. Two measured options: (a) `tauriCommand` - the library spawns `cargo tauri dev --features e2e-testing` itself (risks: the fixture is per-test, so the app is spawned once per test; `pnpm` cannot be spawned without a shell on Windows; and the library sets `TAURI_PLAYWRIGHT_SOCKET` in the child env, which may switch the plugin back to a Unix socket); (b) the documented Windows `cdp` mode - `use: { mode: 'cdp' }` plus `cdpEndpoint: 'http://localhost:9222'`, with the app launched under `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` (no bridge process, full native Playwright, but IPC mocks are browser-mode only, so the desktop tests would drive the real credential store). **RESOLVED 2026-10-12 - option (b) is wired and the suite is green.** `cdp` is not merely the documented Windows mode, it is the only workable one: option (a) fails even when the library spawns the app itself, because the fixture discards the `{ tcpPort }` that `TauriProcessManager.start()` resolves from `listening on tcp://127.0.0.1:<port>` and then constructs `new PluginClient(socketPath)` unconditionally (dist/index.js:1703-1708), so the client always dials the Unix socket path the Windows plugin never creates. The three gaps of `cdp` are closed in the harness: the project runs `use: { mode: 'cdp' }` with `cdpEndpoint: process.env.TAURI_E2E_CDP ?? 'http://127.0.0.1:9222'` (`e2e/fixtures.ts`); `e2e/tauri-app.spec.ts` navigates the window to the preview origin itself (cdp ignores `devUrl`), which also partitions its writes away from the app's own profile, and waits for the app shell instead of `window.__PW_ACTIVE__` (that flag is set only by the socket mode's mocks); and the app lifecycle moved into `scripts/e2e-desktop.mjs` (`pnpm test:e2e:desktop`), which resolves the release then debug binary, launches it with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>`, polls `GET /json/version`, runs `playwright test --project=tauri` and stops the app it started. Measured: the endpoint answered on the first poll with `Edg/154.0.4258.62`, page `http://tauri.localhost/` titled `شورى`, **4 passed (13.5s) exit 0**, no leftover process. Two pre-existing spec defects surfaced because this suite had never been green: the new-session locator matched six buttons (four session rows share the default title `جلسة جديدة`) and the provider locator used `exact: true` although `opencodego`'s accessible name also carries the desktop-required badge (`browserDirect: false` in `src/lib/providers/registry.ts`). Caveats recorded: `cdp` installs no IPC mocks, so the desktop tests reach the real credential backend (read-only use) and a developer's WebView2 profile is persistent - CI would start empty.
- [ ] Step 3: Add a Windows CI job that runs it, and update the Linux job so the two projects never run in the wrong place. **BLOCKED until Step 2 is green**, and it needs a cost decision: CI already has web/rust/nsis jobs, so a fourth Windows job would build the app and run the 4 desktop tests (the nsis job already produces a binary it could reuse). The Linux half is done - the web job runs `pnpm test:e2e:browser` and, with the `testMatch` above, the desktop spec can no longer leak into it.
- **Progress 2026-10-12 (Step 1 COMPLETED, Step 2 PARTIALLY COMPLETED, Step 3 BLOCKED).** Measured the desktop suite instead of trusting the older T0.4 note: `pnpm test:e2e:tauri` = **4 failed**, all with one root cause. The fixture waits 30 s for the Unix socket file `/tmp/tauri-playwright.sock` that the Windows plugin never creates, because the plugin actually listens on TCP `127.0.0.1:6274` - verified by starting the app (`pnpm tauri:dev:e2e` compiled the `e2e-testing` feature, launched the window, and logged both the TCP listener and its HTTP server, while the socket file stayed absent). The Rust half of the bridge is already correct (optional `tauri-plugin-playwright` behind the `e2e-testing` feature, added to the builder only under that cfg, so the release build never compiles it), so the gap is entirely the fixture launch wiring.
- **One real defect fixed while measuring: the desktop project ran the browser specs too.** `--project=tauri` collected 4 desktop tests **plus 12 browser-mode specs** (axe, focus, reflow) because the project relied on `testIgnore: 'app.spec.ts'` alone, and those 13 passes made the 4 real failures look like a partial success. It is now scoped by `testMatch: 'tauri-app.spec.ts'`: `--list` shows exactly 4 desktop tests, bare `pnpm test:e2e --list` shows 28 with no duplicates, and the node typecheck plus eslint on the config PASS.
- **A slip caught by the gate:** the first cut of that edit dropped the project `use: { mode: 'tauri' }` line, which would have silently run the desktop project in browser mode; `tsc` failed with `TS6133 'PlaywrightTestOptions' is declared but never used`, the line was restored, and the re-run gave `TSC_EXIT=0` / `ESLINT_EXIT=0`.
- **Step 2 COMPLETED 2026-10-12 - `cdp` wired, desktop suite green.** Added: `scripts/e2e-desktop.mjs` plus `pnpm test:e2e:desktop` (owns the app lifecycle), `use: { mode: 'cdp' }`, `cdpEndpoint`, a spec that navigates to the preview origin and waits for `main`, and three locator fixes. Evidence: `pnpm test:e2e:desktop` **4 passed (13.8s) exit 0** and `pnpm test:e2e:tauri` **4 passed (13.5s) exit 0**; `pnpm test:e2e:browser` **24 passed (1.1m) exit 0**; `pnpm typecheck` exit 0; `pnpm exec eslint scripts/e2e-desktop.mjs e2e/fixtures.ts e2e/tauri-app.spec.ts playwright.config.ts` exit 0; `pnpm exec tauri build --debug --no-bundle` exit 0. Step 3 stays BLOCKED on a CI cost decision.

### T6.2 - Desktop smoke for the CSP/wasm path

- [x] Step 1: Add a desktop test that loads an embedding model, embeds a string, and returns a search result - the exact path the production CSP previously broke and the browser E2E cannot see.
- [x] Step 2: Verify it FAILs against the pre-T1.3 CSP (proving the test has teeth) and PASSes after.
- **Step 1 PARTIAL by design - the runtime is tested, the 130 MB model download is not.** `e2e/tauri-csp.spec.ts` runs on the app's OWN origin (`http://tauri.localhost`), where the production CSP is the one actually enforced, and asserts: `WebAssembly` instantiates a synthetic module and compiles the **bundled** ORT wasm (13.58 MB, served 200 from the app origin, zero `securitypolicyviolation` events); the bundled ORT chunk initialises (`InferenceSession`/`env`), `wasmPaths` point at the app origin, and a session attempt with four invalid bytes is rejected *after* the runtime fetched its own wasm - i.e. ORT started instead of reporting no backend. Downloading `multilingual-e5-small` (130 MB) for a real embed + search needs the network and the Rust-side HTTP plugin, so it is deliberately left to an opt-in live suite and the gate stays deterministic and offline. **NEEDS USER DECISION:** whether to add that live model test (bandwidth cost + CI network access).
- **Step 2 COMPLETED 2026-10-12 - the teeth are proven in both directions.** Reverted `script-src` to its pre-T1.3 value (`'self'` only), rebuilt (`pnpm exec tauri build --debug --no-bundle`, exit 0) and ran the desktop suite: **2 failed / 4 passed, exit 1**, the second failure carrying the exact production symptom - `no available backend found. ERR: [wasm] RuntimeError: Aborted(CompileError: WebAssembly.instantiate(): ... violates ... Content Security policy ... because 'unsafe-eval' is not an allowed source of script)`. Restored `'wasm-unsafe-eval'`, rebuilt (exit 0) and re-ran: **6 passed (18.7s), exit 0**. Two defects in the new spec were caught on the way: `pnpm build` compiles `e2e/`, so `tsc` rejected two implicitly-typed `page.evaluate` parameters, and the fixture type is the union `TauriPage | BrowserPageAdapter`, whose `playwrightPage` had to be narrowed before the network listeners would compile.

### T6.3 - MSI decision

- [x] Step 1: Record the facts (WiX `light.exe` needs .NET 3.5; this host and CI lack it). **COMPLETED 2026-10-12** - `light.exe` (WiX 3, used by the MSI target) requires .NET Framework 3.5; it is not installed on this host and is not part of the chosen CI image. Measured: `src-tauri/target/release/bundle/msi` holds **0 files** while `--bundles nsis` succeeds and produces a 4,095,495-byte installer.
- [x] Step 2: Decide with the user: ship NSIS only (and document it) or add the prerequisite and also produce `.msi`. Write the decision into `docs/environment.md` and `docs/release-checklist.md`. **COMPLETED 2026-10-12** - decision: **NSIS only, unsigned** (Q3 Windows-first + Q4 no certificate). Recorded in `docs/environment.md` section 11.1 and in the new `docs/release-checklist.md` section 1 (the exact command `pnpm tauri:build:windows`, the artifact `bundle/nsis/shura_0.1.0_x64-setup.exe`, and the re-open path if a `.msi` is ever wanted). No code change is needed: the target is selected on the command line (`--bundles nsis`), which is what the script already runs.

### T6.4 - Cross-platform build check

- [x] Step 1: Add CI jobs that run `pnpm tauri build` on Linux and, if the user accepts the cost, macOS; the Linux job needs the WebKitGTK packages the Rust job already installs. **DECIDED NOT TO ADD (Q3, 2026-10-12):** Windows is the only shipped platform, so no full `tauri build` job is added on Linux and no macOS job at all. The optional Linux compile check already exists in `.github/workflows/ci.yml` (job `rust`: WebKitGTK packages plus `cargo fmt --check`, `cargo check --locked`, `cargo test --locked`), and job `nsis` builds and uploads the installer on `windows-latest`. A Linux package build or a macOS runner would add CI cost for an artifact nobody ships; widening the matrix is the user's call.
- [x] Step 2: Record which platforms are supported (not merely compilable) for this release. **COMPLETED 2026-10-12:** recorded in `docs/release-checklist.md` section 2 as a table - **Windows 10/11 x64 supported and shipped**; **Linux x64 not supported, compile check only** (evidence: the CI `rust` job); **macOS not supported, never built**. `docs/environment.md` section 7 carries the same statement and forbids a README or release-note claim of Linux/macOS support.

### T6.5 - Windows code signing

- [x] Step 1: Determine whether a signing certificate is available (user decision; BLOCKED if not). **ANSWERED BY Q4 (2026-10-05):** no certificate is available, so there is nothing to sign with.
- [x] Step 2: If available, wire `bundle.windows.certificateThumbprint` (or the CI secret equivalent), sign, and verify the installer signature with `Get-AuthenticodeSignature`. **NOT APPLICABLE - no certificate exists**, so no thumbprint, CI secret or verification step could be wired; the conditional step is closed rather than left open.
- [x] Step 3: If not available, record the unsigned-install warning and the SmartScreen consequence explicitly in the release checklist. **COMPLETED 2026-10-12:** `docs/release-checklist.md` section 3 records the measured `Get-AuthenticodeSignature` result (`Status: NotSigned`), the absence of any signing configuration in `src-tauri/tauri.conf.json` or CI, what a user sees (SmartScreen unknown-publisher prompt for a downloaded installer, and why a local copy may not warn), the accepted consequences (no authenticity or integrity check, install friction, no enterprise `.msi`), and the path to sign later. `docs/environment.md` section 11.1 points at it.

### T6.6 - Version, changelog, tag

- [x] Step 1: Agree the release version (currently 0.1.0) and set it in `package.json` and `src-tauri/tauri.conf.json` (and `Cargo.toml` if it carries a version). **COMPLETED 2026-10-12 - no change needed:** the version `0.1.0` is already declared in all three files (measured: `package.json` line 3, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` line 3), and the built installer is named `shura_0.1.0_x64-setup.exe`.
- [x] Step 2: Create `CHANGELOG.md` with a Keep-a-Changelog entry summarising M0-M5, the two HIGH fixes, and the known limitations (unsigned installer, platforms supported). **COMPLETED 2026-10-12:** `CHANGELOG.md` (120 lines) follows Keep a Changelog 1.1.0 and SemVer. One `## [Unreleased] - version 0.1.0` entry carries Added / Changed / Fixed (NH-01, NH-02 with their measured cause, plus the M0-M5 correctness fixes) / Security / Known limitations (10 items, each pointing at its evidence) and a milestone table for M0-M5. `pnpm docs:numbers:check` exit 0.
- [x] Step 3: Tag only when the user asks; do not create tags autonomously. **NO TAG CREATED (2026-10-12):** `git tag --list` is empty (exit 0) and no tag or release was created; `CHANGELOG.md` states this and says how to rename the section when the installer is published.

### T6.7 - Live provider verification (unblocked 2026-10-11; the provider-level half is done)

**Files:** `e2e/live/*` (new, opt-in and excluded from the default run), `scripts/e2e-live.mjs`, `scripts/live-secret-scan.mjs`, `scripts/e2e-desktop.mjs` (now project-agnostic), `playwright.config.ts`, `package.json` (the two new scripts), `docs/release-checklist.md`.

- [x] Step 1 (partly done 2026-10-11): the provider-level checklist for OpenCode Go is executed and recorded in review section 13 (models, non-streaming, streaming, session header, 401). Remaining: one real turn per provider **through the app** (OpenRouter, Gemini, MiniMax, OpenCode Go), cancel, retry, a 429 if obtainable, and cost/usage recording. Corrected free models: `longcat-2.5-preview-free`, `step-5-preview-free`, `space-bunny`, `mimo-v2.6-flash`.
- [x] Step 2: Gate the suite behind an explicit environment switch so it never runs in CI and never runs without a key; a missing key means SKIPPED, not FAIL. **COMPLETED 2026-10-12:** the switch is `SHURA_LIVE_E2E` (`e2e/live/liveGate.ts`), and each provider's key is read from `SHURA_LIVE_<PROVIDER>_KEY` with `OPENCODE_API_KEY` as the documented OpenCode Go fallback (Q5 - no duplicated secret). `playwright.config.ts` adds the `live` project only when the switch equals 1 (`...liveProject`) and the browser project also ignores `**/live/**`. **Exclusion proof (switch off):** `pnpm exec playwright test --list` printed 32 test lines and **0** matched `live/`; `pnpm exec playwright test --project=live --list` exited 1 (the project does not exist). **Skip proof (switch on, no key):** `SHURA_LIVE_NO_DOTENV=1 pnpm test:e2e:live` -> `1 skipped`, exit 0, driving the real `src-tauri/target/debug/app.exe` over CDP; `scripts/e2e-live.mjs` sets the switch and prints variable names and presence only.
- [x] Step 3: Add the test-only injection seam: seed the app's own credential store from an environment variable (`never` from a committed file, never echoed to output, never logged). The key must not appear in any fixture, snapshot, trace or report - check `test-results/` and `playwright-report/` after the first run for leakage before trusting the seam. **COMPLETED 2026-10-12:** `e2e/live/liveApp.ts#seedProviderKey` writes the key through the app's own Settings dialog (`#provider-key-<id>` -> blur -> the `اختبار` button must become enabled -> `تم`), so the value follows the production path into the OS keychain and never passes through a fixture, `addInitScript`, a test title or a snapshot. The live project runs with `trace`/`screenshot`/`video` off. `scripts/live-secret-scan.mjs` (`pnpm check:live-secrets`) reads every `/(KEY|TOKEN|SECRET|PASSWORD|PASSWD)/i` environment value of >= 8 characters into memory, scans `test-results/` and `playwright-report/`, and prints counts and leaking paths only - never a value and never the matching line. **Teeth proven:** a sentinel (`FAKE_SCANNER_SECRET` + `test-results/leak-probe.txt`) -> `leaks: 1`, exit 1; probe removed -> `leaks: 0`, exit 0. With `.env` loaded (the real key in scope) the scan reports 1 secret in scope, 1 artifact file, **0 leaks**. `.env` is untracked (`git ls-files .env` -> 0) and ignored (`.gitignore:5`). `pnpm typecheck` and `pnpm lint` PASS.
- [x] Step 4: Execute and record PASS/FAIL per provider and model. Verify OpenCode Go from the packaged desktop app, since it may reject non-desktop callers; if it refuses, record that as a provider observation rather than working around it. **COMPLETED 2026-10-12 (OpenCode Go PASS; three providers BLOCKED):** `pnpm test:e2e:live` -> **1 passed (9.9 s)** against the packaged desktop app (`src-tauri/target/debug/app.exe` over WebView2 CDP on `http://tauri.localhost/`): OpenCode Go + `longcat-2.5-preview-free` returned a non-empty answer with **no** provider error and rendered the usage footer (annotation `provider=opencodego model=longcat-2.5-preview-free usageRecorded=true keySource=environment providerError=none`; test 6,312 ms, run 9,877 ms). The first attempt failed on a seam bug - `.first()` matched OpenRouter's test button because every provider card shares one `#section-providers` container (the per-provider id is only on the key input) - fixed by scoping to the field's own card (`field.locator("xpath=..")`). **BLOCKED, not a pass:** OpenRouter, Gemini and MiniMax have no credential on this machine, so no app-level turn was executed for them. `pnpm check:live-secrets` after the real run reported 0 leaks, including the JSON report copied into `test-results/`.
- [x] Step 5: If no key is supplied, record BLOCKED and state it in the release notes; do not claim live verification. **COMPLETED 2026-10-12:** `docs/release-checklist.md` section 4 records OpenCode Go as PASS and OpenRouter/Gemini/MiniMax as BLOCKED with the reason (no credential), and the `CHANGELOG.md` known-limitations item states that only OpenCode Go was live-verified. The un-keyed path was verified the same day: `SHURA_LIVE_NO_DOTENV=1 pnpm test:e2e:live` -> 1 skipped, exit 0.

### T6.8 - Release checklist

**Files:** Create `docs/release-checklist.md`.

- [x] Step 1: Encode the "Definition of production ready" section above as a literal tick-list with the exact command and the artifact each step proves. **Note (2026-10-12, T6.3):** `docs/release-checklist.md` already exists with its packaging section - extend it, do not recreate it. **COMPLETED 2026-10-12:** `docs/release-checklist.md` section 5 maps the seven points of the definition to one tick-list row each (exact command, artifact, measured status): point 1 `pnpm check:all` PASS (exit 0, base entry 1,108,374 B of 1,200,000); point 2 browser 24 passed + desktop 6 passed (18.7 s); point 3 **PARTIAL** - first run and the real provider turn PASS, upload -> embed -> search **NOT RUN** (T6.2 residual, needs the 130 MB model); point 4 `pnpm docs:numbers:check` exit 0; point 5 `pnpm audit:check` PASS (11 registered, production 1 moderate registered); point 6 open; point 7 PASS for OpenCode Go with **Q7 open** for the remaining providers. Section 5.1 adds the gates the plan mandates elsewhere (A1 live provider suite, A2 automated a11y, A3 human a11y, A4 clean-machine install, A5 candidate freshness) and section 5.2 the candidate facts.
- [x] Step 2: Include the backout: how to withdraw an installer, which data-format versions are forward-compatible (Dexie v6, archive schema v2), and what a user sees on downgrade. **COMPLETED 2026-10-12:** section 6 records the withdrawal procedure (no updater plugin in `src-tauri/tauri.conf.json`, no backend, no telemetry - delete the artifact, note it in `CHANGELOG.md`, bump the patch version in `package.json`/`src-tauri/Cargo.toml`/`src-tauri/tauri.conf.json`, re-issue), the data locations, and the format versions: `src/lib/db/db.ts` is Dexie **v6** (v3-v6 additive tables/indexes, v2's upgrade backfills existing `sessions`/`usage_events` rows) with **no handler for Dexie's `VersionError` anywhere in `src`** (grep: 0 matches), so an older build is expected to fail at the first DB open rather than lose data - not exercised, since no older build exists; and `ARCHIVE_SCHEMA_VERSION = 2` (`src/lib/markdown/writer.ts:289`) whose reader also normalizes a manifest with no `schemaVersion` as legacy v1 (`writer.ts:362-363`), while the reverse direction is unverified. **Correction found here:** the installer **had** been installed on this host (`HKCU` uninstall entry, `%LOCALAPPDATA%\shura`, `app.exe` 0.1.0 of 2026-09-25, 4 archives in `Documents\Shura\sessions`), so the `CHANGELOG.md` known limitation, section 1 of the checklist and the `TASKS.md` T6.3 bullet were corrected.

---

## Milestone M7 - Backlog and documentation reconciliation

**Why:** several plan documents are stale in ways that mislead. Review `2 already showed the README drifting in the safe direction; `docs/plans/2026-09-28-shura-fix-milestones.md` has open checkboxes for work that is demonstrably done (its milestone 2 is implemented in `src/lib/tokens/estimate.ts`).

### T7.1 - Re-verify the old milestone checkboxes

**Files:** Modify `docs/plans/2026-09-28-shura-fix-milestones.md`, `docs/plans/2026-10-05-i18n-progress.md`.

- [x] Step 1: For each open item, check the current tree and mark it done with the file/line that proves it, or carry it into this plan as a new task. Do not mark anything done without evidence. **DONE 2026-10-12:** all 60 boxes are resolved - 31 verified implemented with inline file:line evidence, 26 carried into this plan (T7.3-T7.6), 2 closed (2.4 not adopted; 7.1 pinned by design) and 1 already tracked by T3.2 (7.7). M1/M2 were verified by me and M3-M7 by five read-only verifiers whose citations I spot-checked.
- [x] Step 2: Close the i18n plan's one open item (the visual smoke test) by recording it as a human gate in M5/T5.3 rather than leaving it dangling. **DONE 2026-10-12:** that item is now `[x]` as TRANSFERRED, and **D6** was added to `docs/accessibility-manual-pass.md` section 7 with the sign-off row updated to D1-D6, so the human gate lives with M5/T5.3.
- [x] Step 3: Leave `.superpowers/sdd/progress-ledger.md` untouched - it is the closed MVP ledger. **DONE 2026-10-12:** the file was not touched in this session.

### T7.2 - Final truthfulness pass

- [x] Step 1: Re-run `pnpm docs:numbers` after the last code change and confirm a clean tree. **DONE 2026-10-12:** `pnpm docs:numbers:check` exit 0 ('PASS: the documents match the measured artifacts'), with one recorded NOTE: `dist/assets` holds `rolldown-runtime-Dd_uD5pT.js`, which has no documented row. Counts: testsPassed 1159; statements 88.75%; branches 82.23%; functions 86.48%; lines 92.65%; base entry 1,108.37 kB of the 1,200,000-byte budget (headroom 91.63 kB).
- [x] Step 2: Read `README.md`, `docs/environment.md`, `docs/troubleshooting.md` and `docs/user-guide.md` end to end and delete or fix every claim the current build does not reproduce. **DONE 2026-10-12 - 18 claims corrected across the four documents, every one re-checked by hand: README.md 6 (provider-card scope, `check:all` chain, `test:e2e` -> `test:e2e:browser` and 12/24 -> 24/24, four -> five transport domains, live model sources, Playwright 12 -> 24); `docs/environment.md` 7 (tsconfig include, lint ignores, `check:all` chain, 12 -> 24 browser, the section-8.2 bundle contradiction, a percentage that followed from neither figure, the dated section-12 row); `docs/user-guide.md` 3 (dev port 5173 -> 127.0.0.1:5174, `pnpm tauri build` -> `pnpm tauri:build:windows`, `chars / 4`); `docs/troubleshooting.md` 2 (`chars / 4`, a non-existent about dialog). The audit's `Ctrl+1`-`Ctrl+9` finding was REFUTED (`Composer.tsx:55-67`) and the row restored. `CHANGELOG.md` gained the M6 row so the milestone table runs M0-M6. Machine/artifact-dependent claims were left untouched as unverifiable.**
- [x] Step 3: Add the review and this plan to the docs index if one exists. **N/A - no docs index exists (2026-10-12):** `docs/` holds 8 markdown files and no `index.md` or `README.md`, and `README.md` references only `docs/environment.md` inline (lines 23, 42, 65, 138). There is nothing to add the review or this plan to, so this is recorded rather than invented.
- [x] Step 4: Resolve Q6: `.gitignore` ignores `docs/reviews/*` except the hardening smoke record, so the 2026-10-05 review is untracked. Either add a negation for it or record the decision that reviews stay local, so the deliverable is not silently lost. **DONE 2026-10-12 (option A, user decision):** `docs/reviews/*` stays local. The decision is written into `.gitignore` above the rule, into `TASKS.md` (Done) and into the progress file, so a future reader cannot mistake the untracked review for a lost deliverable.

### T7.3 - Redaction: one owner, and the formats the policy names

**Why:** carried forward by T7.1 from the 2026-09-28 plan (items 5.1, 5.3, 5.4; MEDIUM). Measured 2026-10-12: the key-test detail reaches the UI redacted, but only by a second heuristic redactor inside `mapProviderError` (`src/lib/providers/keyTest.ts:31-38`) - which `src/lib/security/redact.ts:2-4` explicitly forbids - and the canonical rules (`redact.ts:44-64`) have none of the four key formats the old item names.

**Files:** `src/lib/security/redact.ts`, `src/lib/providers/keyTest.ts`, `src/features/settings/ProviderKeyCard.tsx`, `src/lib/security/redact.spec.ts`.

- [x] Step 1: Make `redactExternalError` the only redactor on this path: call it from `mapProviderError`'s fallback and at the display boundary (`ProviderKeyCard.tsx:61`), and delete the local heuristic. RED first: a spec proving an AWS-shaped 20-character key currently survives and is removed after the change. **DONE 2026-10-12 (RED -> GREEN):** the eight-line heuristic is deleted, `mapProviderError(e, secret?)` now ends in `return redactExternalError(msg, secret ? { secrets: [secret] } : {})`, both of its call sites pass the tested key (`keyTest.ts:84`, `:90`), and `ProviderKeyCard.tsx:61-63` runs `r.detail` through the same function with the saved key before `setResult`. RED evidence, captured before the implementation: `keyTest.spec.ts` failed with `expected 'odd failure AKIAIOSFODNN7EXAMPLE 418' not to contain 'AKIAIOSFODNN7EXAMPLE'` and all four new `redact.spec.ts` cases failed (`AIza...`, `ghp_...`, `client_secret=...`, a patternless known secret) - 5 failed / 30 passed, exit 1. The heuristic's message key died with it: `errors.keyRedacted` had exactly three references (`en.ts`, `ar.ts`, `keyTest.ts:36`), so it was removed from both locale files and `grep keyRedacted src` is now 0 matches. **Recorded amendment beyond the literal step:** the deleted heuristic incidentally covered any secret longer than 30 characters, so removing it alone would have *reduced* coverage for a format the policy does not name (a 32-hex MiniMax-style key). `RedactOptions` therefore gained an optional `secrets?: readonly string[]`, applied as a literal (case-sensitive) replacement before the rules with a `MIN_SECRET_LENGTH = 8` floor so a short value cannot mangle the message, and the caller that actually holds the key passes it. Both new parameters are optional, so no caller breaks.
- [x] Step 2: Add the patterns the item names - `AIza[0-9A-Za-z_-]{35}`, `ghp_[A-Za-z0-9]{36}`, `xoxb-[0-9]+-[0-9]+-[A-Za-z0-9]+`, `AKIA[0-9A-Z]{16}` - plus a `client_secret` match that does not depend on `_` being a non-word character. **DONE 2026-10-12:** all five rules are in `redactionRules` (`src/lib/security/redact.ts`), the first four as bare prefixed shapes and the fifth as `/(client[_-]?secret)\b\s*[:=]\s*"?[^\s",}]+/gi -> "$1=" + marker`, which matches without relying on a word boundary after `_`.
- [x] Step 3: Add a spec case per new pattern (and for the shapes that already pass), so the gap cannot return silently. **DONE 2026-10-12 - 7 new specs, all green:** four in `src/lib/security/redact.spec.ts` (the four formats together, `client_secret=`, a known secret that matches no pattern, and the negative case that a sub-8-character value is *not* redacted), two in `src/lib/providers/keyTest.spec.ts` (an AWS-shaped key in an unclassified body never reaches `detail`; the tested key is removed even when its format is unknown) and one end-to-end in `src/features/settings/ProviderKeyCard.spec.tsx` (the display boundary never renders the saved key). Targeted run after the fix: **13 + 17 + 11 passed, exit 0.**
- [x] Step 4: Run `pnpm check:all` and record the result in `docs/plans/2026-10-05-production-readiness-progress.md`. **DONE 2026-10-12: `pnpm check:all` exit 0 (PASS)** - `tsc --noEmit` + `tsc --noEmit -p tsconfig.node.json` + `vite build`, `check-bundle`, `check-audit` all completed (the build's two `var(--sura-*)` CSS warnings and the `INEFFECTIVE_DYNAMIC_IMPORT` note are pre-existing). This is the first task whose test count moved, so the generated spans were refreshed: `pnpm docs:numbers` (1162 -> **1169 tests / 1166 passed**) followed by `pnpm docs:numbers:check` -> **PASS** (coverage 88.81 / 82.35 / 86.54 / 92.70; base entry 1,108.56 kB of the 1,200,000-byte budget, headroom 91.44 kB).

### T7.4 - Salvage usage when a turn is stopped or fails

**Why:** carried forward by T7.1 (items 3.2, 3.4, 3.5; MEDIUM). A stopped or failed turn records 0 tokens; the writer defaults every field (`src/lib/chat/chatController.ts:692-694`) and `grep salvage src` is 0 matches, so cost reporting silently under-counts.

**Files:** `src/lib/chat/dispatch.ts`, `src/lib/chat/chatController.ts`, `src/lib/chat/dispatch.spec.ts`, `src/lib/chat/partialStreaming.spec.ts`.

- [x] Step 1: Capture the last usage-bearing stream part in `dispatchTurn` and attach it to the stopped/error outcome. **DONE 2026-10-12, RED -> GREEN, after measuring the SDK first.** A temporary probe spec (created, run, deleted) measured ai@7.0.92 directly: on an **abort** the parts are `start, start-step, text-start, text-delta` - no `finish-step` - and `result.usage` stays **PENDING** forever (it never resolves *or* rejects), so awaiting it on the stop path would hang the outcome; on an **abrupt close** (no abort) the SDK does emit `finish-step` with the real usage and `result.usage` resolves. The salvage therefore takes what already streamed: `lastUsage` is set from each `finish-step` part, `costModelForUsage` now resolves before `streamText` (the T2.3/NM-03 computation moved up, comment included), and `salvageUsage()` attaches `toUsage(lastUsage, costModelForUsage)` to the stopped/timeout resolve and to the `catch` outcome. The real gap this closes is a multi-step tool flow: step 1 completes and reports usage, then the turn is stopped during step 2 - previously recorded as 0 tokens.
- [x] Step 2: Record that usage in `chatController.ts` instead of relying on the `?? 0` defaults, and delete the now-stale limitation comment at `dispatch.ts:138`. **DONE 2026-10-12 - and the honest finding is that `chatController.ts` needed no change:** all ten usage sites already pass `outcome.usage` straight through (`chatController.ts:632`, `:666`, `:716`) and default per field only when usage is genuinely absent (`:692-697`, `costUSD` null at `:697`), so the defect was upstream in `dispatchTurn` alone. Making that explicit, the `?? 0` defaults are for a stream that never reported usage, not for stopped turns. The stale comment is gone, replaced by the measured note on the resolve path. Chain coverage already existed: `chatController.spec.ts:537` asserts the persisted rows carry `inputTokens === 7` / `outputTokens === 3`.
- [x] Step 3: Tests: a stopped outcome carries non-zero usage after tokens were consumed; `costUSD` is lower when `cachedInputTokens > 0`; `maxRetries: 0` is asserted. **DONE 2026-10-12:** (a) `dispatch.spec.ts` gained the RED test - a two-step tool flow where the second request is a controllable SSE stream, aborted after its first delta - which failed `expected undefined to be 7` before the fix and now asserts `usage.inputTokens === 7` and `outputTokens === 3` on a `stopped` outcome; (b) `costUSD` with `cachedInputTokens > 0` was **already covered** by `registry.spec.ts:59-64` ('uses cache-read pricing': 0.000256 with 80 cached tokens vs 0.0006 if all input were uncached), so it is recorded as existing evidence rather than duplicated; (c) `maxRetries: 0` now has a behavioural guard - a 500 response from the provider must leave exactly **one** fetch call (`dispatch.spec.ts`), which fails if the option is removed. Also pinned in `partialStreaming.spec.ts`: a single-step stop has `usage === undefined` (the measured SDK boundary), so nobody re-introduces an `await result.usage` that would hang.
- [x] Step 4: Run `pnpm check:all` and record the result in the progress file. **DONE 2026-10-12: `pnpm check:all` exit 0 (PASS)** - **1168 passed / 3 skipped of 1171** across 109 files, `check:bundle` `PASS: base entry 1108654 bytes is within the 1200000-byte budget (headroom 91346 bytes)`, `check:audit` PASS (every advisory registered, no re-review date passed). `pnpm docs:numbers` then `pnpm docs:numbers:check` -> PASS (coverage 88.82 / 82.40 / 86.55 / 92.71; base entry 1,108.65 kB; headroom 91.35 kB).

### T7.5 - Regression tests for the persistence hardening

**Why:** carried forward by T7.1 (item 4.4; MEDIUM). The three protections landed (`src/lib/db/repos/usage.ts:14`, `src/lib/markdown/archivePaths.ts:84-86`, `src/lib/db/repos/turns.ts:49-50`) but two of the three tests the item requires are missing, so they are unpinned.

**Files:** `src/lib/db/repos.spec.ts`, `src/lib/markdown/archivePaths.spec.ts` (create if absent), `src/lib/sessionDeletion.spec.ts`.

- [x] Step 1: Simulate the tombstone race - call `deleteSessionData` between the check and the put - and assert no orphan usage row is written. **DONE 2026-10-12:** two tests in `repos.spec.ts` under `describe("turns and tombstones (schema v2)")`. (a) The race itself - `Promise.allSettled([recordUsage(...), deleteSessionData(...)])` - asserts the invariant that matters: the tombstone exists and `usage_events` for the session is **0** (Dexie serialises, so the delete is either seen by the check, which rejects, or it removes the row after the put). (b) The structural pin - `recordUsage` must call `db.transaction("rw", [db.usage_events, db.tombstones], fn)`; **teeth proven by mutation**: removing the `db.transaction` wrapper from `usage.ts` makes exactly this test fail (`expected "Mock" to be called with arguments: [ 'rw', …(2) ]`) and the code was restored. An earlier version of (b) measured `Dexie.currentTransaction` around the check and the put and **passed even with the wrapper removed** (Dexie zone leakage) - recorded here because it was discarded as unsound, not silently kept.
- [x] Step 2: Assert `readDiskTombstones` throws `TombstoneSetError` for a non-ENOENT `readDir` failure (`archivePaths.ts:84-86`). **DONE 2026-10-12:** `src/lib/markdown/archivePaths.spec.ts` was **created** (it did not exist) with 5 tests using `memoryFileSink()` plus a wrapper whose `readDir` throws a coded error: `EPERM`/`EACCES` -> `TombstoneSetError`; `ENOENT` -> empty set (absence is not corruption); a valid witness set is read; a witness whose `id` contradicts its filename -> `TombstoneSetError`; unparsable witness content -> `TombstoneSetError`.
- [x] Step 3: Assert `importSessionAtomically` rejects when the session already exists (`repos/turns.ts:49-50`). **DONE 2026-10-12:** `repos.spec.ts` test 'importSessionAtomically يرفض جلسة موجودة بدل تكرار صفوفها' - creates `dup`, then asserts the import rejects with `/already exists/` and that `sessions.count() === 1`, `getMessages("dup") === []`, `getTurns("dup") === []` and **no** `usage_events` row for `dup` (no partial write).
- [x] Step 4: Run `pnpm check:all` and record the result in the progress file. **DONE 2026-10-12: `pnpm check:all` exit 0 (PASS)** - **1176 passed / 3 skipped of 1179** across **110** files, `check:bundle` `PASS: base entry 1108654 bytes is within the 1200000-byte budget (headroom 91346)` (byte-for-byte unchanged: T7.5 is test-only), `check:audit` PASS. `pnpm docs:numbers` then `pnpm docs:numbers:check` -> PASS (counts.tests 1179, counts.testsPassed 1176). Test-count change therefore regenerated README.md + docs/environment.md.

### T7.6 - Low-severity backlog from the 2026-09-28 review

**Why:** T7.1 found that milestone 7 of `docs/plans/2026-09-28-shura-fix-milestones.md` (25 items, all Low) is mostly genuine backlog rather than unticked work. Nothing here blocks 0.1.0, but each item needs an explicit accept-or-fix record instead of an ambiguous open box. Item 7.7 is not repeated here: it is the Class-4 Arabic literal at `src/lib/markdown/parser.ts:304` already named in T3.2's residual list.

- [ ] Step 1 - chat pipeline: settle the `waitForIdle` residual or document it (`src/lib/chat/operationCoordinator.ts:253`; the behaviour is pinned at `operationCoordinator.spec.ts:187`); name the model id in the overflow error (`src/lib/chat/context.ts:15`); delete the dead spread at `src/lib/chat/chatController.ts:142`; stop binding `operationSignal` twice (`chatController.ts:201-213`).
- [ ] Step 2 - archive and recovery: per-session existence check in `src/lib/startupRecovery.ts:36`; orphan attempt files or a documented leak around `src/lib/markdown/writer.ts:527`; rename or document `archiveQueueDepth` (`src/lib/markdown/archiveQueue.ts:21`); hand the manifest to the parser instead of re-reading `meta.json` (`parser.ts:203/278/354`); validate `onDiskDir` in `normalizeSessionMeta` (`src/lib/markdown/writer.ts:204`).
- [ ] Step 3 - the remaining milestone-7 items, all verified absent on 2026-10-12: guard `staticModels[0]` (`ProviderKeyCard.tsx:61`); add catch or logging in `sessionsStore.ts:51`; freeze or factory-ise `EMPTY_COMPOSER_DRAFT` (`composerStore.ts:42`); code-point truncation (`composerStore.ts:77/82`); RTL-aware chevron (`ResultCard.tsx:77`); resolve or document the `aborts`/`stopped` refs (`ChatScreen.tsx:109-112`); unmount cleanup for the stream timer (`useSummaryExtraction.ts:521`); wire `is_within_root` into a command or record the deferral (`src-tauri/src/lib.rs:2`); warn before the quota-spending fallback (`keyTest.ts:80`); cache the in-flight credential-store promise (`credentialBackend.ts:52`); build the key-check URL with `new URL` (`keyTest.ts:58`).
- [ ] Step 4: For each item, either fix it or record **accepted - Low** in `docs/plans/2026-10-05-production-readiness-progress.md`; then run `pnpm check:all` and record the result.

**New in T7.2 (2026-10-12):** the in-app shortcut help dialog renders only the seven global shortcuts, so `Ctrl+Enter` (chat send) and `Ctrl+1`-`Ctrl+9` (focus target) are real but absent from the app's own list (`App.tsx:146` passes `useAppShortcuts()`'s array to `ShortcutHelpDialog.tsx:21-30`, while `useChatShortcuts.ts` and `Composer.tsx:55-67` register the two missing). The descriptions themselves are localised (`t("keyboard.*")`), so this is completeness, not i18n. Accept or fix in Step 4.

---

## Milestone M8 - Review reconciliation (2026-10-16)

**Why:** a read-only review of the uncommitted hardening tree
(`docs/reviews/2026-10-16-shura-current-state-review.md`, local per Q6) returned
**PASS WITH CONCERNS** with six findings where documented behaviour and the tree
disagree: two MEDIUM (a delivered feature wired to nothing) and four LOW (dead
code, a redaction gap, a mixed-concern module). Severity is labelled M (medium)
/ L (low) to match that review. Every task below is COMPLETED in the same
session; the milestone exists so the reconciliation is recorded, not lost.

### T8.1 - Wire the temp-cleanup policy (finding M1)

**Files:** `src/features/chat/persistTurn.ts`, `src/state/sessionsStore.ts`, `src/main.tsx`.

- [x] Step 1: `persistTurn` runs the `after_turn` policy in its `finally` (best-effort `try/catch`), `sessionsStore` runs the `after_session` policy when a session is left (`open`/`newSession`/`remove`, the removed id captured before the switch), and `main.tsx` runs the startup orphan sweep when the policy is not `manual`. **DONE 2026-10-16:** the three cleanup entry points (`scheduleTempCleanup`, `cleanupTempFiles`, `cleanupOrphanedTempFiles`) now have production callers; no behaviour changes for `manual`.

### T8.2 - Route DOCX in the file processor (finding M2)

**Files:** `src/lib/rag/fileProcessor.ts` (+ spec), `src/lib/rag/docxExtractor.ts` (+ spec), `src/features/chat/Composer.tsx`, `src/features/rag/RagFileManager.tsx`.

- [x] Step 1: `fileProcessor` carries `docx: "docx"` in `typeMap` and a `case "docx": return extractDocxText(file)`; the dead `isDocxSupported` is removed; `.docx` is added to both upload accept attributes. **DONE 2026-10-16:** `fileProcessor.spec.ts` mocks `./docxExtractor` and pins the route (a DOCX now detects as `docx`, is supported, and reaches `extractDocxText`); the unsupported-path fixture moved to `a.xyz`.

### T8.3 - Delete the dead `apiEmbedder` (finding L1)

**Files:** `src/lib/rag/apiEmbedder.ts`, `src/lib/rag/apiEmbedder.spec.ts`.

- [x] Step 1: Deleted both files after grepping every importer and barrel (none). **DONE 2026-10-16:** the live embedding boundary is `embedder.ts` alone.

### T8.4 - Redact error text at the logging sink (finding L2)

**Files:** `src/lib/logging.ts` (+ spec).

- [x] Step 1: `logging.ts` runs the console string, `metrics.lastError.message` and the `unhandledrejection` reason through `redactExternalError` (the single sanctioned redactor, T7.3). **DONE 2026-10-16:** a spec asserts the persisted message is redacted; no import cycle (`redact.ts` reads only `@/i18n`).

### T8.5 - Delete the dead `sonner` UI wrapper (finding L3)

**Files:** `src/components/ui/sonner.tsx`, `src/components/ui/sonner.spec.tsx`.

- [x] Step 1: Deleted both files after grepping every importer and barrel (none). **DONE 2026-10-16:** the Toaster stays mounted from `main.tsx` with the app token mapping (T5.1); `next-themes` (its only importer, and tree-shaken) was then removed as an unused dependency.

### T8.6 - Extract the summary persistence module (finding L4)

**Files:** `src/features/chat/summaryPersistence.ts` (new), `src/features/chat/hooks/useSummaryExtraction.ts`, `src/features/chat/fileBudget.spec.ts`.

- [x] Step 1: `createSummaryPersistence(deps)` (the verbatim `archiveSummary` + `runSummarySidecars` pair) moved into `src/features/chat/summaryPersistence.ts`; the hook calls the factory and the now-unused imports were dropped; the 550-line `useSummaryExtraction.ts` ceiling was removed from `fileBudget.spec.ts`. **DONE 2026-10-16:** the file now clears the 500-line production budget without an exemption.

---

## Execution order and dependencies

```
M0 (T0.1..T0.4)  --+--> M1 (T1.0 -> T1.1 -> T1.2 ; T1.3 ; T1.4..T1.6) --+--> M6
                   +--> M2 (T2.1..T2.9)                                 |
                   +--> M3 (T3.1 -> T3.2 -> T3.3, T3.4)                 |
                   +--> M4 (T4.1)                                       |
                   +--> M5 (T5.1..T5.3) --------------------------------+
M7 last (after M0..M6, so the re-verification reflects the shipped tree)
M8 after M7 (a review of the shipped tree; T8.1-T8.6 reconcile six findings)
```

- Hard dependencies: T1.0 -> T1.1 -> T1.2; T0.2 before T1.0 (to measure the tokenizer cost); T1.3 after T1.1 (the local tokenizer changes what is downloaded); T3.2 after T3.1 (the persist rule first); T6.2 after T1.3.
- Independent tracks: M2, M4 and M5 can proceed in parallel with M1. M3 shares files with M2 (`dispatch.ts` gains keys, `keyTest.ts` is rewritten by T2.6), so sequence T2.6 before T3.2 for `keyTest.ts`.
- Every task must leave `pnpm check:all` green. A task that cannot is not finished.

## Rollback and compatibility

- **Database:** Dexie v6 is additive (new table/index only). Downgrade guidance must be written into ADR 0003 and the release checklist; do not delete rows in `upgrade()` (the v5 precedent).
- **Archives:** the on-disk schema stays at version 2 unless a task explicitly changes it; if it does, it needs its own ADR and a migration path both ways.
- **CSP:** the change from CDN to local assets is one file plus a contract test; reverting it is a single commit. Never ship NH-02 half-fixed (CSP changed but assets still remote) - the contract test exists to prevent exactly that.
- **Dependencies:** every added dependency (D1) must be recorded with its measured bundle cost and be removable behind one module boundary (`modelCache.ts` / `embedder.ts`).

## Validation matrix (which command proves which finding is fixed)

| Finding | Proof |
|---|---|
| NH-01 | `embedder.spec.ts` golden ids, the T1.2 staleness test, `pnpm test` |
| NH-02 | `cspContract.spec.ts` plus the T6.2 desktop smoke |
| NM-01..NM-05 | their regression specs plus `pnpm test` |
| NM-06 | `pnpm audit:check` plus the register plus the `docs/environment.md` diff |
| NM-07 | `pnpm check:bundle` plus `pnpm docs:numbers` on a clean tree |
| NL-01..NL-06 | their specs, `pnpm test`, and the build output |
| LV-02 | the T2.7 reasoning-state spec plus a recorded live turn |
| LV-03 | the T2.9 null-pricing spec; no `$` figure appears for an unattributed rate |
| LV-04 | the T2.8 authenticated-catalog specs (key sent; unentitled id refused) |
| LV-07 | the T3.4 formatter specs across the card, the writer and the exporter |
| M1 (2026-10-16) | the cleanup callers are reachable (`persistTurn` finally, `sessionsStore` leave, `main.tsx` sweep) |
| M2 (2026-10-16) | `fileProcessor.spec.ts` DOCX routing test (mocked `extractDocxText`) |
| L1, L3 (2026-10-16) | `pnpm typecheck` + `pnpm test` green with the two spec files deleted |
| L2 (2026-10-16) | the `logging.spec.ts` redaction assertion |
| L4 (2026-10-16) | `fileBudget.spec.ts` passes with the 550 ceiling removed |
| Release | `docs/release-checklist.md` fully ticked |

## Decisions recorded during execution

- **Q7 (2026-10-11)** - does the 1,200,000-byte budget apply to the base entry or to the whole eager payload? **Answered: keep D7 (base entry) for now.** `pnpm check:bundle` prints the eager total and does not gate it; T1.3 Step 9 makes the RAG chunks actually lazy and then switches the gate to the eager total in the same change, so the gate is never born red.

## Open questions (remaining)

- **Q5 - RESOLVED 2026-10-11.** The key is in `.env` as `OPENCODE_API_KEY`; the provider-level verification is recorded in review section 13 and T6.7 is unblocked.
- **Q6 - RESOLVED 2026-10-12 (option A, user decision).** `.gitignore` line 23 ignores `docs/reviews/*` with a single exception for the hardening smoke record, so the current review document and this plan's review references are untracked. The question was whether to commit them (add an exception or a negation) or leave them local. **Decision:** reviews stay local; the decision is recorded in `.gitignore`, `TASKS.md` and the progress file.

## Progress tracking

- Update `docs/plans/2026-10-05-production-readiness-progress.md` after every task: milestone checkbox, ledger row (task, status, base commit, head commit, evidence, minor findings), the append-only evidence log, and the "start here next" line.
- Keep `TASKS.md` to near-term items only; it is a view, not a second source of truth.
- Findings discovered while executing this plan go into the ledger's minor-findings column and into the review document's progress log, so nothing is lost between sessions.
