# Shura — Fix Milestones Plan

**Source:** Comprehensive code review (2026-09-28)  
**Total findings:** 2 High, 14 Medium, 29 Low  
**Goal:** Fix all High and Medium findings; address Low findings as time permits.

---

## Milestone 1: Archive Queue Key Unification (H1)

**Priority:** CRITICAL  
**Estimated effort:** Small (1-2 hours)  
**Files touched:** src/lib/markdown/archiveQueue.ts, src/lib/markdown/writer.ts, src/lib/sessionDeletion.ts, src/lib/chat/chatController.ts, src/features/chat/ChatScreen.tsx, src/state/sessionsStore.ts, src/lib/desktop/bootstrap.ts

### Problem
The writer queues on the **relative** path `sessions/` + onDiskDir while deletion queues on the **absolute** configured sessionRootDir. archiveQueueKey only strips trailing slashes, so the two keys are different strings, different Map entries, no serialization. The documented invariant *an in-flight append can never land after a deletion* is false in production.

### Tasks

- [ ] **1.1** Export a canonical path constructor `archiveSessionPath(rootDir, onDiskDir)` from archivePaths.ts. This function should produce a single canonical form regardless of whether the input is relative or absolute.
- [ ] **1.2** Update writer.ts writeSessionMeta and appendTurn to call `runExclusiveInArchive(archiveSessionPath(rootDir, dir), ...)` instead of `runExclusiveInArchive(dir, ...)`. The rootDir should be resolved from the active sink (Tauri sink already knows the root; memory sink uses `sessions`).
- [ ] **1.3** Update sessionDeletion.ts deleteSessionDurably to use the same canonical key. Replace `archivePathFor(rootDir, onDiskDir)` with the canonical form.
- [ ] **1.4** Update chatController.ts:370 and ChatScreen.tsx:635 to pass the canonical path to the writer.
- [ ] **1.5** Add a test in archiveQueue.spec.ts (or writer.spec.ts) that verifies a relative-path writer call and an absolute-path deletion call share the same queue entry (i.e., the second waits for the first).
- [ ] **1.6** Run `pnpm test:coverage` to confirm no regressions.

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

- [ ] **2.1** Add a helper `estimateTokens(text)` that detects Arabic script (Unicode ranges 0600-06FF, 0750-077F, 08A0-08FF, FB50-FDFF, FE70-FEFF) and uses `chars / 2.5` for Arabic-heavy text, `chars / 4` for Latin. For mixed text, weight by the proportion of Arabic vs Latin characters.
- [ ] **2.2** Replace the estimate function in context.ts:9-10 with the new helper.
- [ ] **2.3** Add tests in context.spec.ts:
  - Pure Arabic text of known character count produces a higher token estimate than the old formula.
  - Mixed Arabic/Latin text produces an estimate between the two extremes.
  - The 80% budget check correctly rejects an Arabic prompt that would exceed the window.
- [ ] **2.4** Consider adding a safety multiplier (e.g., `budget * 0.85`) to account for tokenizer variance across providers.
- [ ] **2.5** Run `pnpm test:coverage`.

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

- [ ] **3.1** In dispatch.ts:141, pass `cachedInputTokens: u.inputTokenDetails?.cacheReadTokens ?? 0` to `computeCost`. Verify the `computeCost` signature accepts it (registry.ts:71).
- [ ] **3.2** In dispatch.ts, when the stream errors or is aborted, salvage usage from the last usage-bearing chunk. The AI SDK exposes `result.usage` even on error in many cases. Attach it to the `DispatchOutcome` so chatController can record it.
- [ ] **3.3** In dispatch.ts:110, set `maxRetries: 0` on `streamText` to prevent unrecorded SDK retries. If explicit retry is desired, implement it with per-attempt usage aggregation.
- [ ] **3.4** Update chatController.ts:669-672 to use the salvaged usage from the outcome instead of defaulting to 0.
- [ ] **3.5** Add/update tests:
  - A test that `costUSD` is lower when `cachedInputTokens > 0`.
  - A test that a stopped outcome carries non-zero usage when tokens were consumed.
  - A test that `maxRetries: 0` is set.
- [ ] **3.6** Run `pnpm test:coverage`.

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

- [ ] **4.1** In repos.ts:356-360, wrap the tombstone check + `put` in a single `db.transaction("rw", [db.usage_events, db.tombstones], ...)` so the check is atomic with the write.
- [ ] **4.2** In archivePaths.ts:75-80, distinguish ENOENT (return empty set) from other errors (rethrow as `TombstoneSetError`). The `recoverFromDisk` caller already fails closed on `TombstoneSetError`.
- [ ] **4.3** In repos.ts:125-152, inside the transaction, check `const existing = await db.sessions.get(meta.id)`. If it exists, either reject with an error or merge (delete existing messages/turns for the session first) before writing.
- [ ] **4.4** Add tests:
  - A test that `recordUsage` for a deleted session does not create an orphan row (simulate the race by calling `deleteSessionData` between the check and the put).
  - A test that `readDiskTombstones` throws `TombstoneSetError` on a non-ENOENT `readDir` error.
  - A test that `importSessionAtomically` rejects or merges when the session already exists.
- [ ] **4.5** Run `pnpm test:coverage`.

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

- [ ] **5.1** In ProviderKeyCard.tsx:57, pass `r.detail` through `redactExternalError` before setting it in state: `setResult(redactExternalError(r.detail))`.
- [ ] **5.2** In credentialStore.ts:94-95, update the comment to accurately state the limitation: *Web apps cannot truly secure secrets without a backend. The JWK is stored in IndexedDB and is readable by any script in the same origin. This provides obfuscation, not real security. Desktop mode uses the OS keychain.*
- [ ] **5.3** In redact.ts, add patterns for:
  - Google API keys: `AIza[0-9A-Za-z_-]{35}`
  - GitHub tokens: `ghp_[A-Za-z0-9]{36}`
  - Slack tokens: `xoxb-[0-9]+-[0-9]+-[A-Za-z0-9]+`
  - AWS access keys: `AKIA[0-9A-Z]{16}`
  - `client_secret` (use a boundary that does not rely on `_` being a non-word character)
- [ ] **5.4** Add tests for the new redact patterns.
- [ ] **5.5** Run `pnpm test:coverage`.

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

- [ ] **6.1** In ChatScreen.tsx:37, replace `useSettingsStore()` with a selector: `useSettingsStore((s) => s.providerKeys)` or whatever subset is actually needed. This prevents re-renders on unrelated settings changes.
- [ ] **6.2** In ChatScreen.tsx:47-91, fix the hydration effect to not depend on `messages`. Use a ref to track whether hydration has already occurred, or move the hydration logic to a `useEffect` with `[]` deps that reads from a ref.
- [ ] **6.3** Add a guard in `doSend` (or the Composer send button) that disables sending when there are no targets or the prompt is empty. Show a message via `ar` i18n.
- [ ] **6.4** Extract hardcoded Arabic strings from ChatScreen.tsx, StatusAnnouncer.tsx, ResultCard.tsx, ResultCards.tsx, Composer.tsx into src/i18n/ar.ts.
- [ ] **6.5** Break up ChatScreen.tsx (995 lines) into smaller components: extract the message list, the result cards, the synthesis flow, and the operation lifecycle into separate files under src/features/chat/.
- [ ] **6.6** In SettingsScreen.tsx:25, fix the `invalidPrimary` check to not flag live-model providers (OpenRouter `modelsSource: "live"`) as invalid. The check should only validate that the primary target provider/model combination is in the static list when `modelsSource === "static"`.
- [ ] **6.7** In Composer.tsx:43, make the target badge keyboard accessible: add `role="button"`, `tabIndex={0}`, `onKeyDown` handler for Enter/Space, and `aria-label`.
- [ ] **6.8** Run `pnpm test:coverage` and `pnpm test:e2e`.

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

- [ ] **7.1** Fix `waitForIdle` hang risk in operationCoordinator.ts, have `cancel()` also settle the pending promise.
- [ ] **7.2** Add Arabic patterns to `mapProviderError` in keyTest.ts.
- [ ] **7.3** Improve the oversized-question error message in context.ts:12 to include the model id and an actionable hint.
- [ ] **7.4** Remove dead-code spread in chatController.ts:133.
- [ ] **7.5** Move `status?.("streaming")` inside the try block in dispatch.ts:62-63.
- [ ] **7.6** Skip the second signal bind when `external === operationSignal` in chatController.ts:200-202.
- [ ] **7.7** Fix `recoverFromDisk` to use a separate `warnings` array instead of pushing to `errors` for unattributed usage.
- [ ] **7.8** Fix `startupRecovery` to check per-session existence instead of a global count.
- [ ] **7.9** Clean up orphaned attempt files after a crash (or document the leak as acceptable).
- [ ] **7.10** Rename `archiveQueueDepth()` to `archiveQueueDirs()` or implement actual depth tracking.
- [ ] **7.11** Read meta.json once in `recoverFromDisk` and pass the string to the parser.
- [ ] **7.12** Validate `onDiskDir` with `isSafePathSegment` in `normalizeSessionMeta`.
- [ ] **7.13** Add explicit `createdAt` offsets in `buildMessages` to avoid relying on stable sort.
- [ ] **7.14** Fix ProviderKeyCard.tsx:57 potential crash if `p.staticModels` is empty.
- [ ] **7.15** Add error handling to sessionsStore.ts:59 `load()`.
- [ ] **7.16** Fix `EMPTY_COMPOSER_DRAFT` shared mutable object in composerStore.ts:38.
- [ ] **7.17** Use `Array.from(str)` or `[...str]` instead of `slice` for surrogate-pair-safe truncation in composerStore.ts.
- [ ] **7.18** Fix chevron rotation direction in ResultCard.tsx:50 for RTL.
- [ ] **7.19** Remove dead code: `aborts`/`stopped` refs in ChatScreen.tsx, `draft` state in Sidebar.tsx.
- [ ] **7.20** Fix `setInterval` leak in `extractSummary` on unmount.
- [ ] **7.21** Wire `path_policy.rs` to relevant Tauri commands (or add a TODO comment).
- [ ] **7.22** Add quota-spend warning before `generationCheck` fallback in keyTest.ts.
- [ ] **7.23** Fix `initializeCredentialStore` race condition with a promise cache.
- [ ] **7.24** Fix `keyListingCheck` URL construction to use the `URL` API.
- [ ] **7.25** Run `pnpm test:coverage` and `pnpm test:e2e`.

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