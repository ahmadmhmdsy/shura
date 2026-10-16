# Shura — Fix Milestones Plan

**Source:** Comprehensive code review (2026-09-28)  
**Total findings:** 2 High, 14 Medium, 29 Low  
**Goal:** Fix all High and Medium findings; address Low findings as time permits.

**Status (reconciled 2026-10-12 by T7.1 of `docs/plans/2026-10-05-production-readiness-plan.md`):** every checkbox in this file was checked against the tree at `f96c738` plus the uncommitted working tree, because the work had been done but never ticked. Evidence is inline on each line. Items marked 'by a different design' met the acceptance criteria by other means than the one literally described; 'CLOSED - not adopted' records a deliberate decision rather than a code change. Nothing is ticked without a file:line or a command result. **CARRY FORWARD -> T7.x** means the box is resolved as *tracked*: the work is genuinely not implemented in this tree and now lives in the production-readiness plan. Of the 60 boxes, **31 are implemented**, **26 are carried** into the production-readiness plan (T7.3-T7.6), **2 are closed** (2.4 not adopted; 7.1 pinned by design) and **1 is already tracked** by T3.2 (7.7).

---

## Milestone 1: Archive Queue Key Unification (H1)

**Priority:** CRITICAL  
**Estimated effort:** Small (1-2 hours)  
**Files touched:** src/lib/markdown/archiveQueue.ts, src/lib/markdown/writer.ts, src/lib/sessionDeletion.ts, src/lib/chat/chatController.ts, src/features/chat/ChatScreen.tsx, src/state/sessionsStore.ts, src/lib/desktop/bootstrap.ts

### Problem
The writer queues on the **relative** path `sessions/` + onDiskDir while deletion queues on the **absolute** configured sessionRootDir. archiveQueueKey only strips trailing slashes, so the two keys are different strings, different Map entries, no serialization. The documented invariant *an in-flight append can never land after a deletion* is false in production.

### Tasks

- [x] **1.1** Export a canonical path constructor `archiveSessionPath(rootDir, onDiskDir)` from archivePaths.ts. This function should produce a single canonical form regardless of whether the input is relative or absolute. **DONE 2026-10-12 by a different design (T7.1):** no `archiveSessionPath` export exists (`grep archiveSessionPath` -> 0 matches). The canonical key is `archiveQueueKey` (`src/lib/markdown/archiveQueue.ts:15-19`), which reduces any path to its last segment because the writer passes a relative path while deletion passes an absolute one - the reasoning is written out at `archiveQueue.ts:8-13`.
- [x] **1.2** Update writer.ts writeSessionMeta and appendTurn to call `runExclusiveInArchive(archiveSessionPath(rootDir, dir), ...)` instead of `runExclusiveInArchive(dir, ...)`. The rootDir should be resolved from the active sink (Tauri sink already knows the root; memory sink uses `sessions`). **DONE 2026-10-12 by a different design:** `writeSessionMeta` and `appendTurn` both publish through the shared queue - `runExclusiveInArchive(dir, ...)` at `src/lib/markdown/writer.ts:490` and `:503` - so no call site has to build the canonical path.
- [x] **1.3** Update sessionDeletion.ts deleteSessionDurably to use the same canonical key. Replace `archivePathFor(rootDir, onDiskDir)` with the canonical form. **DONE 2026-10-12 by a different design:** deletion publishes through the same queue (`src/lib/sessionDeletion.ts:70`). `archivePathFor` survives only as a local path builder (`sessionDeletion.ts:44-46`); the queue key comes from `archiveQueueKey`.
- [x] **1.4** Update chatController.ts:370 and ChatScreen.tsx:635 to pass the canonical path to the writer. **DONE 2026-10-12:** the writer is called with the session `dir` and deletion with `archivePathFor(rootDir, onDiskDir)`; both reduce to the same last segment (`onDiskDir`), so they serialize - pinned by 1.5.
- [x] **1.5** Add a test in archiveQueue.spec.ts (or writer.spec.ts) that verifies a relative-path writer call and an absolute-path deletion call share the same queue entry (i.e., the second waits for the first). **DONE 2026-10-12:** `src/lib/markdown/archiveQueue.spec.ts:71-76` queues a relative `sessions/my-session` and an absolute `C:/Users/test/Documents/Shura/sessions/my-session` and asserts serialization; `:55-60` pins the trailing-slash case.
- [x] **1.6** Run `pnpm test:coverage` to confirm no regressions. **DONE 2026-10-12:** `pnpm check:all` PASS exit 0, which runs `pnpm test:coverage` with the thresholds enforced (`docs/plans/2026-10-05-production-readiness-progress.md`, ledger T6.8).

### Acceptance criteria
- Writer and deletion use the same queue key for the same on-disk directory.
- A test proves serialization between a relative-path append and an absolute-path deletion.
- All existing tests pass.

---

## Milestone 2: Arabic-Aware Context Estimation (H2)

**Priority:** HIGH  
**Estimated effort:** Small-Medium (2-3 hours)  
**Files touched:** src/lib/chat/context.ts, src/lib/chat/context.spec.ts, possibly src/lib/tokens/estimate.ts

### Problem
`estimate = Math.ceil(totalChars / 4)` is calibrated for English. Arabic tokenizes at ~2.5-3 chars/token, so the real token count is ~1.3-1.6x the estimate. The 80% budget check passes prompts that exceed the model context window, causing provider 400 errors on long Arabic conversations.

### Tasks

- [x] **2.1** Add a helper `estimateTokens(text)` that detects Arabic script (Unicode ranges 0600-06FF, 0750-077F, 08A0-08FF, FB50-FDFF, FE70-FEFF) and uses `chars / 2.5` for Arabic-heavy text, `chars / 4` for Latin. For mixed text, weight by the proportion of Arabic vs Latin characters. **DONE 2026-10-12:** `estimateTokens` lives in `src/lib/tokens/estimate.ts:22` with the Arabic ranges at `:3-5` (`0600-06FF, 0750-077F, 08A0-08FF, FB50-FDFF, FE70-FEFF`).
- [x] **2.2** Replace the estimate function in context.ts:9-10 with the new helper. **DONE 2026-10-12:** `src/lib/chat/context.ts:3` imports it and `:13` sums `estimateTokens(row.text)`; the old `Math.ceil(totalChars / 4)` is gone (0 matches for `totalChars`).
- [x] **2.3** Add tests in context.spec.ts: **DONE 2026-10-12:** `src/lib/chat/context.spec.ts:145` (Arabic > Latin), `:152-154` (mixed between the extremes), `:163-178` (a full Arabic turn trims differently), and the 80% budget rejection at `:33-34` and `:158-160`.
  - Pure Arabic text of known character count produces a higher token estimate than the old formula.
  - Mixed Arabic/Latin text produces an estimate between the two extremes.
  - The 80% budget check correctly rejects an Arabic prompt that would exceed the window.
- [x] **2.4** Consider adding a safety multiplier (e.g., `budget * 0.85`) to account for tokenizer variance across providers. **CLOSED - not adopted (T7.1, 2026-10-12):** no safety multiplier exists (`0.85`/`multiplier`: 0 matches) and the window stays `contextLength * 0.8` (`src/lib/chat/context.ts:15`). The item was a 'consider'; the Arabic-aware estimator above landed instead. Reopen if measurement ever shows the estimate under-counts.
- [x] **2.5** Run `pnpm test:coverage`. **DONE 2026-10-12:** same evidence as 1.6 - `pnpm check:all` PASS with the coverage thresholds.

### Acceptance criteria
- Arabic text produces a token estimate ~1.5x higher than the old formula.
- A long Arabic conversation that would exceed the context window is correctly trimmed or rejected.
- All existing tests pass.

---

## Milestone 3: Cost and Usage Accounting Fixes (M1, M2, M3)

**Priority:** MEDIUM  
**Estimated effort:** Medium (3-4 hours)  
**Files touched:** src/lib/chat/dispatch.ts, src/lib/chat/chatController.ts, src/lib/chat/dispatch.spec.ts, src/lib/chat/partialStreaming.spec.ts

### Problem
Three distinct gaps:
1. `costUSD` computed without `cachedInputTokens`, cost overcounted when providers report cached tokens.
2. Error/stopped outcomes carry no `usage`, `recordUsage` records 0 tokens despite real consumption.
3. SDK `maxRetries` default (2) consumes unrecorded tokens; `result.usage` reflects only the final attempt.

### Tasks

- [x] **3.1** In dispatch.ts:141, pass `cachedInputTokens: u.inputTokenDetails?.cacheReadTokens ?? 0` to `computeCost`. Verify the `computeCost` signature accepts it (registry.ts:71). **DONE 2026-10-12 (T7.1):** src/lib/chat/dispatch.ts:71 reads u.inputTokenDetails?.cacheReadTokens ?? 0 and feeds it to computeCost at :76-78; the cost input type carries the field (src/lib/providers/registry.ts:104).
- [x] **3.2** In dispatch.ts, when the stream errors or is aborted, salvage usage from the last usage-bearing chunk. The AI SDK exposes `result.usage` even on error in many cases. Attach it to the `DispatchOutcome` so chatController can record it. **CARRY FORWARD (T7.1) -> production-readiness plan T7.4 Step 1:** not implemented - the gap is written down as a limitation (src/lib/chat/dispatch.ts:138 'This is a known limitation - stopped/error outcomes record 0 tokens'), the abort path (:139-145) and the catch (:248) attach no usage, and grep salvage over src returns 0 matches.
- [x] **3.3** In dispatch.ts:110, set `maxRetries: 0` on `streamText` to prevent unrecorded SDK retries. If explicit retry is desired, implement it with per-attempt usage aggregation. **DONE 2026-10-12 (T7.1):** maxRetries: 0 is set on streamText at src/lib/chat/dispatch.ts:180 (the only production hit besides the key-test generation call at src/lib/providers/keyTest.ts:70).
- [x] **3.4** Update chatController.ts:669-672 to use the salvaged usage from the outcome instead of defaulting to 0. **CARRY FORWARD (T7.1) -> T7.4 Step 2:** src/lib/chat/chatController.ts:692 still writes inputTokens: outcome.usage?.inputTokens ?? 0 (and :693-694 likewise), because 3.2 gives the outcome no salvaged usage.
- [x] **3.5** Add/update tests: **PARTIAL -> T7.4 Step 3:** the cache-read pricing test exists (src/lib/providers/registry.spec.ts:59 'uses cache-read pricing', asserting 0.000256 with cachedInputTokens: 80), and propagation is asserted at src/lib/chat/dispatch.spec.ts:139; missing: a stopped-outcome non-zero-usage test and any maxRetries: 0 assertion (grep maxRetries over src finds only the two production lines).
  - A test that `costUSD` is lower when `cachedInputTokens > 0`.
  - A test that a stopped outcome carries non-zero usage when tokens were consumed.
  - A test that `maxRetries: 0` is set.
- [x] **3.6** Run `pnpm test:coverage`. **DONE 2026-10-12:** pnpm check:all PASS exit 0, which runs pnpm test:coverage with the thresholds enforced (same evidence as 1.6).

### Acceptance criteria
- `costUSD` reflects cached token pricing.
- Stopped/error outcomes record real token consumption.
- No unrecorded SDK retries.
- All existing tests pass.

---

## Milestone 4: Persistence Hardening (M4, M5, M6)

**Priority:** MEDIUM  
**Estimated effort:** Medium (3-4 hours)  
**Files touched:** src/lib/db/repos.ts, src/lib/markdown/archivePaths.ts, src/lib/db/repos.spec.ts, src/lib/markdown/archivePaths.spec.ts

### Problem
1. `recordUsage` has a TOCTOU race: tombstone check and `put` are separate transactions, orphan usage rows for deleted sessions.
2. `readDiskTombstones` fails OPEN on `readDir` error (returns empty set), contradicting its *fails closed* contract.
3. `importSessionAtomically` does not check for an existing session, silent overwrite.

### Tasks

- [x] **4.1** In repos.ts:356-360, wrap the tombstone check + `put` in a single `db.transaction("rw", [db.usage_events, db.tombstones], ...)` so the check is atomic with the write. **DONE 2026-10-12 (T7.1):** the tombstone check and the put share one read-write transaction at src/lib/db/repos/usage.ts:14 (the code moved out of the old repos.ts).
- [x] **4.2** In archivePaths.ts:75-80, distinguish ENOENT (return empty set) from other errors (rethrow as `TombstoneSetError`). The `recoverFromDisk` caller already fails closed on `TombstoneSetError`. **DONE 2026-10-12 (T7.1):** src/lib/markdown/archivePaths.ts:84 returns an empty Set only for ENOENT while :86 rethrows TombstoneSetError for every other readDir error, so recovery fails closed.
- [x] **4.3** In repos.ts:125-152, inside the transaction, check `const existing = await db.sessions.get(meta.id)`. If it exists, either reject with an error or merge (delete existing messages/turns for the session first) before writing. **DONE 2026-10-12 (T7.1):** the in-transaction existence check at src/lib/db/repos/turns.ts:49-50 rejects an existing session instead of overwriting it.
- [x] **4.4** Add tests: **CARRY FORWARD (T7.1) -> T7.5:** two of the three regression tests this item requires are absent. Present: three importSessionAtomically cases (src/lib/db/repos.spec.ts:182, :193, :212) and a sequential delete-then-write case (:145). Missing: any spec mentioning TombstoneSetError (grep finds it only in archivePaths.ts:61-100), any non-ENOENT readDir test, and any existing-session reject test (0 spec hits for 'already exists').
  - A test that `recordUsage` for a deleted session does not create an orphan row (simulate the race by calling `deleteSessionData` between the check and the put).
  - A test that `readDiskTombstones` throws `TombstoneSetError` on a non-ENOENT `readDir` error.
  - A test that `importSessionAtomically` rejects or merges when the session already exists.
- [x] **4.5** Run `pnpm test:coverage`. **DONE 2026-10-12:** pnpm check:all PASS exit 0 (same evidence as 1.6).

### Acceptance criteria
- No orphan usage rows.
- `readDiskTombstones` fails closed on unreadable directories.
- `importSessionAtomically` is safe to call on existing sessions.
- All existing tests pass.

---

## Milestone 5: Security Hardening (M7, M8)

**Priority:** MEDIUM  
**Estimated effort:** Small (1-2 hours)  
**Files touched:** src/features/settings/ProviderKeyCard.tsx, src/lib/security/credentialStore.ts, src/lib/security/redact.ts

### Problem
1. Key test result `r.detail` is displayed without redaction, potential API key leak in UI.
2. Web credential store stores device key as plaintext JWK in IndexedDB, misleading comment claims it is secure.
3. Redact regex does not cover Google API keys (AIza...), client_secret, or other common formats.

### Tasks

- [x] **5.1** In ProviderKeyCard.tsx:57, pass `r.detail` through `redactExternalError` before setting it in state: `setResult(redactExternalError(r.detail))`. **CARRY FORWARD (T7.1) -> T7.3 Step 1 (partially mitigated):** src/features/settings/ProviderKeyCard.tsx:61 still sets r.detail straight into state. What protects it today is a second heuristic redactor inside mapProviderError (src/lib/providers/keyTest.ts:31-38), which contradicts the one-owner rule stated at src/lib/security/redact.ts:2-4 ('no second redactor may be created'): it replaces sk-/key-/api- prefixed tokens and anything longer than 30 characters, so a 20-character AWS-style key passes through, and the 400-character body errorWithStatus keeps (keyTest.ts:42) retains paths, URLs and query strings that redactExternalError would strip.
- [x] **5.2** In credentialStore.ts:94-95, update the comment to accurately state the limitation: *Web apps cannot truly secure secrets without a backend. The JWK is stored in IndexedDB and is readable by any script in the same origin. This provides obfuscation, not real security. Desktop mode uses the OS keychain.* **DONE 2026-10-12 (T7.1):** src/lib/security/credentialStore.ts:94-99 states the web limitation accurately (the JWK in IndexedDB is readable by any same-origin script; the desktop OS keychain is stronger).
- [x] **5.3** In redact.ts, add patterns for: **CARRY FORWARD (T7.1) -> T7.3 Step 2:** the canonical rules (src/lib/security/redact.ts:44-64) contain no Google (AIza...), GitHub (ghp_...), Slack (xoxb-...) or AWS (AKIA...) pattern, and client_secret is not matched because \bsecret\b cannot fire after an underscore.
  - Google API keys: `AIza[0-9A-Za-z_-]{35}`
  - GitHub tokens: `ghp_[A-Za-z0-9]{36}`
  - Slack tokens: `xoxb-[0-9]+-[0-9]+-[A-Za-z0-9]+`
  - AWS access keys: `AKIA[0-9A-Z]{16}`
  - `client_secret` (use a boundary that does not rely on `_` being a non-word character)
- [x] **5.4** Add tests for the new redact patterns. **CARRY FORWARD (T7.1) -> T7.3 Step 3:** src/lib/security/redact.spec.ts has no case for any of those formats, which is why the 5.3 gap went unnoticed.
- [x] **5.5** Run `pnpm test:coverage`. **DONE 2026-10-12:** pnpm check:all PASS exit 0 (same evidence as 1.6).

### Acceptance criteria
- Key test results are redacted before display.
- The comment accurately describes the web credential store limitation.
- Redact covers common key formats.
- All existing tests pass.

---

## Milestone 6: UI Robustness (M9-M16)

**Priority:** MEDIUM  
**Estimated effort:** Medium (4-6 hours)  
**Files touched:** src/features/chat/ChatScreen.tsx, src/features/chat/Composer.tsx, src/features/chat/StatusAnnouncer.tsx, src/features/settings/SettingsScreen.tsx, src/i18n/ar.ts

### Problem
8 medium-severity UI issues: over-subscription, hydration re-runs, missing send guard, hardcoded strings, oversized component, false positive validation, keyboard accessibility.

### Tasks

- [x] **6.1** In ChatScreen.tsx:37, replace `useSettingsStore()` with a selector: `useSettingsStore((s) => s.providerKeys)` or whatever subset is actually needed. This prevents re-renders on unrelated settings changes. **DONE 2026-10-12 (T7.1):** src/features/chat/ChatScreen.tsx:44 uses a narrow selector (useSettingsStore((s) => s.providerKeys)) instead of subscribing to the whole store; providerKeys, timeoutMs and primaryTarget are the only settings read.
- [x] **6.2** In ChatScreen.tsx:47-91, fix the hydration effect to not depend on `messages`. Use a ref to track whether hydration has already occurred, or move the hydration logic to a `useEffect` with `[]` deps that reads from a ref. **DONE 2026-10-12 (T7.1):** hydration moved to src/features/chat/hooks/useOperationProgressSync.ts, whose dependency list at :61 excludes messages; the effect reads the store through getState and guards with identity/generation checks.
- [x] **6.3** Add a guard in `doSend` (or the Composer send button) that disables sending when there are no targets or the prompt is empty. Show a message via `ar` i18n. **DONE 2026-10-12 (T7.1):** src/features/chat/ChatScreen.tsx:146 guards the empty-target list and the empty prompt with t("chat.noTargets") / t("chat.emptyPrompt"); both keys exist in the resources.
- [x] **6.4** Extract hardcoded Arabic strings from ChatScreen.tsx, StatusAnnouncer.tsx, ResultCard.tsx, ResultCards.tsx, Composer.tsx into src/i18n/ar.ts. **DONE 2026-10-12 (T7.1):** no user-visible Arabic literal remains in ChatScreen, StatusAnnouncer, ResultCard, ResultCards or Composer (an Arabic-script scan matches comments only); the keys used at ChatScreen.tsx:146 exist at src/i18n/ar.ts:134.
- [x] **6.5** Break up ChatScreen.tsx (995 lines) into smaller components: extract the message list, the result cards, the synthesis flow, and the operation lifecycle into separate files under src/features/chat/. **DONE 2026-10-12 (T7.1):** ChatScreen.tsx is down to ~315 lines; TurnView.tsx, ResultCards.tsx, hooks/useSummaryExtraction.ts, hooks/useOperationProgressSync.ts and persistTurn.ts were extracted (ChatScreen.tsx:5 imports TurnView).
- [x] **6.6** In SettingsScreen.tsx:25, fix the `invalidPrimary` check to not flag live-model providers (OpenRouter `modelsSource: "live"`) as invalid. The check should only validate that the primary target provider/model combination is in the static list when `modelsSource === "static"`. **DONE 2026-10-12 (T7.1):** src/features/settings/SettingsScreen.tsx:45 flags an invalid primary target only when modelsSource === "static", so live-model providers such as openrouter (registry.ts:14) are no longer falsely marked.
- [x] **6.7** In Composer.tsx:43, make the target badge keyboard accessible: add `role="button"`, `tabIndex={0}`, `onKeyDown` handler for Enter/Space, and `aria-label`. **DONE 2026-10-12 (T7.1):** the model badge is a native sibling <button> carrying aria-label/aria-pressed (Composer.tsx:119-123), so keyboard access holds without a hand-rolled role/tabIndex/onKeyDown.
- [x] **6.8** Run `pnpm test:coverage` and `pnpm test:e2e`. **DONE 2026-10-12 (T7.1):** both npm scripts exist (package.json:10-11) and the suites were re-run this session - Playwright last-run passed, browser 24 passed and desktop 6 passed (docs/release-checklist.md section 5, Point 2).

### Acceptance criteria
- ChatScreen only re-renders when its actual dependencies change.
- Hydration effect runs once.
- Sending with empty targets/prompt is prevented.
- All UI strings go through i18n.
- ChatScreen is broken into focused components.
- Primary target validation works for live-model providers.
- Target badges are keyboard accessible.
- All existing tests pass.

---

## Milestone 7: Low-Severity Cleanup (L1-L29)

**Priority:** LOW  
**Estimated effort:** Large (8-12 hours)  
**Files touched:** Various

### Tasks

- [x] **7.1** Fix `waitForIdle` hang risk in operationCoordinator.ts, have `cancel()` also settle the pending promise. **CLOSED - by design (T7.1):** `cancel()` releases immediately (`operationCoordinator.ts:250-254`) and never settles the idle promise; the behaviour is pinned by a test named 'waitForIdle remains pending after immediate cancel until the finalizer finishes' (`operationCoordinator.spec.ts:187`), and the comment at `:248-249` states the binding plan splits cancellation from the durable finalizer. Residual risk (tracked in T7.6): a caller that awaits `waitForIdle` and never receives a finalizer waits indefinitely.
- [x] **7.2** Add Arabic patterns to `mapProviderError` in keyTest.ts. **DONE 2026-10-12 (T7.1):** Arabic patterns for unauthorized, context overflow, rate limit, unreachable and timeout are at `src/lib/providers/keyTest.ts:26-30`, each mapped to an i18n key.
- [x] **7.3** Improve the oversized-question error message in context.ts:12 to include the model id and an actionable hint. **CARRY FORWARD (T7.1) -> T7.6 Step 1:** the overflow error still carries only the limit (`src/lib/chat/context.ts:15`, `KeyedError("errors.contextOverflow", { max: contextLength })`); the actionable hint exists in the resources but the model id is never passed or shown.
- [x] **7.4** Remove dead-code spread in chatController.ts:133. **CARRY FORWARD (T7.1) -> T7.6 Step 1:** the dead spread `...(_target ? {} : {})` is still present at `src/lib/chat/chatController.ts:142`.
- [x] **7.5** Move `status?.("streaming")` inside the try block in dispatch.ts:62-63. **DONE 2026-10-12 (T7.1):** `status?.("streaming")` moved inside the try opened at `src/lib/chat/dispatch.ts:149` (`:151`), so the `finally` cleanup at `:260` runs if it throws.
- [x] **7.6** Skip the second signal bind when `external === operationSignal` in chatController.ts:200-202. **CARRY FORWARD (T7.1) -> T7.6 Step 1:** `bind(external ?? operationSignal)` at `src/lib/chat/chatController.ts:213` still binds `operationSignal` twice, because the only guard is `source === controller.signal` (`:201`).
- [x] **7.7** Fix `recoverFromDisk` to use a separate `warnings` array instead of pushing to `errors` for unattributed usage. **CARRY FORWARD (T7.1) -> already tracked by T3.2 (residual Class-4 site):** `src/lib/markdown/parser.ts:304` still pushes an Arabic literal into `report.errors`, and `RecoveryReport` has no `warnings` field. This is the same Class-4 candidate already named in T3.2's residual list, so it is not duplicated as a new task.
- [x] **7.8** Fix `startupRecovery` to check per-session existence instead of a global count. **CARRY FORWARD (T7.1) -> T7.6 Step 2:** `src/lib/startupRecovery.ts:36` still gates on a global `existingSessionCount() !== 0` instead of checking the specific session.
- [x] **7.9** Clean up orphaned attempt files after a crash (or document the leak as acceptable). **CARRY FORWARD (T7.1) -> T7.6 Step 2:** `src/lib/markdown/writer.ts:527` writes attempt files before the `meta.json` commit marker, with no orphan cleanup and no documented 'acceptable leak' (`recovery.spec.ts:38` only ignores them).
- [x] **7.10** Rename `archiveQueueDepth()` to `archiveQueueDirs()` or implement actual depth tracking. **CARRY FORWARD (T7.1) -> T7.6 Step 2:** the helper is still `archiveQueueDepth()` and returns the number of queued directories (`src/lib/markdown/archiveQueue.ts:21`), not a real depth; the rename the item asked for was not made.
- [x] **7.11** Read meta.json once in `recoverFromDisk` and pass the string to the parser. **CARRY FORWARD (T7.1) -> T7.6 Step 2:** `meta.json` is still read by the parser (`src/lib/markdown/parser.ts:278`) and again by `readArchiveManifest` (`:354`) / `importSessionFromDisk` (`:203`); no manifest string is handed in.
- [x] **7.12** Validate `onDiskDir` with `isSafePathSegment` in `normalizeSessionMeta`. **CARRY FORWARD (T7.1) -> T7.6 Step 2:** `normalizeSessionMeta` still assigns `onDiskDir` unvalidated (`src/lib/markdown/writer.ts:204`); `isSafePathSegment` is neither imported nor used in `writer.ts`.
- [x] **7.13** Add explicit `createdAt` offsets in `buildMessages` to avoid relying on stable sort. **DONE 2026-10-12 (T7.1):** the shared < custom < result ordering uses explicit `t` / `t+1` / `t+2` offsets (`src/lib/markdown/parser.ts:92`, `:104`, `:120`) instead of relying on a stable sort.
- [x] **7.14** Fix ProviderKeyCard.tsx:57 potential crash if `p.staticModels` is empty. **CARRY FORWARD (T7.1) -> T7.6 Step 3:** `ProviderKeyCard.tsx:61` still dereferences `p.staticModels[0].id` with no guard for an empty list.
- [x] **7.15** Add error handling to sessionsStore.ts:59 `load()`. **CARRY FORWARD (T7.1) -> T7.6 Step 3:** `src/state/sessionsStore.ts:51` still has only try/finally (the loading reset); no catch or logging was added and the rejection still propagates.
- [x] **7.16** Fix `EMPTY_COMPOSER_DRAFT` shared mutable object in composerStore.ts:38. **CARRY FORWARD (T7.1) -> T7.6 Step 3:** `src/state/composerStore.ts:42` still exports one shared mutable `EMPTY_COMPOSER_DRAFT`; `grep freeze composerStore.ts` is 0 matches.
- [x] **7.17** Use `Array.from(str)` or `[...str]` instead of `slice` for surrogate-pair-safe truncation in composerStore.ts. **CARRY FORWARD (T7.1) -> T7.6 Step 3:** truncation is still UTF-16 based (`text.slice(0, LIMITS.sharedPromptMax)` at `composerStore.ts:77`, customs at `:82`); no `Array.from` or spread appears in the store.
- [x] **7.18** Fix chevron rotation direction in ResultCard.tsx:50 for RTL. **CARRY FORWARD (T7.1) -> T7.6 Step 3:** the chevron class at `src/features/chat/ResultCard.tsx:77` is unchanged (`-rotate-90`, not an RTL-aware rotation).
- [x] **7.19** Remove dead code: `aborts`/`stopped` refs in ChatScreen.tsx, `draft` state in Sidebar.tsx. **CARRY FORWARD (T7.1) -> T7.6 Step 3:** `src/features/chat/ChatScreen.tsx:109` still holds the `aborts` reuse-effect map (and the `stopped` set at `:112`), now passed into `persistTurn`/`useSummaryExtraction` (`:216-217`); only the Sidebar draft state was removed.
- [x] **7.20** Fix `setInterval` leak in `extractSummary` on unmount. **CARRY FORWARD (T7.1) -> T7.6 Step 3:** the stream timer in `src/features/chat/hooks/useSummaryExtraction.ts:521` is cleared only when the operation settles (`settleStream` finally at `:176`); no unmount-time cleanup was added.
- [x] **7.21** Wire `path_policy.rs` to relevant Tauri commands (or add a TODO comment). **CARRY FORWARD (T7.1) -> T7.6 Step 3:** `pub mod path_policy;` (`src-tauri/src/lib.rs:2`) is declared but no Tauri command calls `is_within_root` (all 15 references are inside `path_policy.rs`) and no TODO records the deferral (`grep TODO src-tauri` = 0 matches).
- [x] **7.22** Add quota-spend warning before `generationCheck` fallback in keyTest.ts. **CARRY FORWARD (T7.1) -> T7.6 Step 3:** the `listing === null` fallback still spends quota through `generationCheck` with no warning (`src/lib/providers/keyTest.ts:80`); T2.6 removed only the catch-path second generation.
- [x] **7.23** Fix `initializeCredentialStore` race condition with a promise cache. **CARRY FORWARD (T7.1) -> T7.6 Step 3:** `src/lib/security/credentialBackend.ts:52` caches only the resolved store, so concurrent callers can still build it twice; the file is unchanged since before the plan.
- [x] **7.24** Fix `keyListingCheck` URL construction to use the `URL` API. **CARRY FORWARD (T7.1) -> T7.6 Step 3:** the key-check URL is still string-concatenated (`src/lib/providers/keyTest.ts:58`; the key is `encodeURIComponent`-escaped, so this is hygiene, not a live injection).
- [x] **7.25** Run `pnpm test:coverage` and `pnpm test:e2e`. **DONE 2026-10-12 (T7.1):** both scripts exist (`package.json:10-11`); coverage runs inside `pnpm check:all` (PASS) and the browser (24 passed) plus desktop (6 passed) e2e suites passed this session (`docs/release-checklist.md` section 5, Point 2). Caveat recorded: bare `pnpm test:e2e` also collects the `tauri` project and exits 1 with no app running, so CI and the docs must keep using `test:e2e:browser` / `test:e2e:desktop`.

### Acceptance criteria
- All low-severity findings addressed or explicitly deferred with a comment.
- All existing tests pass.

---

## Execution Order

```
Milestone 1 (H1)  -->  Milestone 2 (H2)  -->  Milestone 3 (M1-M3)
                                                      |
                                                      v
Milestone 7 (L)  <--  Milestone 6 (M9-M16)  <--  Milestone 5 (M7-M8)
                                                      ^
                                                      |
                                               Milestone 4 (M4-M6)
```

**Recommended sub-agent parallelization:**
- **Agent A:** Milestone 1 + Milestone 4 (both touch persistence/archive layers)
- **Agent B:** Milestone 2 + Milestone 3 (both touch chat pipeline)
- **Agent C:** Milestone 5 + Milestone 6 (both touch UI/security)
- **Agent D:** Milestone 7 (cleanup, can run after A/B/C)

---

## Validation Commands

After each milestone:

```bash
pnpm test:coverage    # Unit tests with coverage thresholds
pnpm test:e2e         # Playwright e2e tests
pnpm typecheck        # TypeScript strict check
pnpm lint             # ESLint
pnpm build            # Production build
```

All must pass before marking a milestone complete.