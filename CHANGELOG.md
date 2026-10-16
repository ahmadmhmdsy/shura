# Changelog

All notable changes to Shura are documented in this file. The format follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and the version follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The **Known limitations** section is a local extension to the core sections. It records what this
build does not do yet, so that no entry below reads as a claim of completeness.

## [Unreleased] - version 0.1.0

**Release status:** version `0.1.0` is set in `package.json`, `src-tauri/tauri.conf.json` and
`src-tauri/Cargo.toml`. No git tag and no published release exist yet (T6.6 Step 3: tags are created
only on an explicit request). Rename this heading to `## [0.1.0] - <date>` when the NSIS installer is
published, and keep the limitation list below with that release.

This entry summarises milestones M0-M8 of `docs/plans/2026-10-05-production-readiness-plan.md`: the
first production-readiness pass over a working application, not its first feature release. M6
(packaging, desktop verification and release) is complete except a Windows desktop-E2E CI job; M7
(backlog and documentation reconciliation) is complete (T7.1-T7.6); and M8 (the
2026-10-16 review reconciliation) is complete. Each milestone has a row in the table at the end.

### Added

- Multi-model chat in an Arabic-first RTL interface: one prompt is fanned out to several models in
  parallel and their answers are compared side by side in one session.
- Provider integrations for OpenRouter, Google Gemini, MiniMax and OpenCode Go, each with a key test,
  a fetched model catalog where the provider exposes one, and explicit static rows where it does not.
- Local document RAG on the desktop: PDF/markdown/text ingestion, embeddings from a bundled
  wasm-only ONNX runtime, a persistent vector index, semantic/keyword/hybrid search, and a document
  scope filter applied before ranking.
- A model cache that downloads the embedding model once and then serves it from the app cache, with a
  single responsible writer and an explicit size contract.
- The desktop CSP that makes the above possible: `script-src 'self' 'wasm-unsafe-eval'` with the
  runtime, tokenizer and wasm assets served from the bundle instead of a CDN.
- A design-token system (`--sura-*`) plus an ESLint rule that rejects raw colour literals and the
  `*-white`/`*-black` utilities, so every screen has one themeable source of colour.
- Localisation for Arabic and English over one resource registry, with parity, placeholder and CLDR
  plural-category tests.
- Automated accessibility coverage: an axe pass over the empty, streaming, error, truncated, RAG and
  settings states, a numeric token-contrast contract, and reflow and focus checks.
- Verification infrastructure: `pnpm check:all` (typecheck, lint, coverage, build, bundle budget,
  audit), a desktop end-to-end project that drives the real Tauri app, and a browser end-to-end suite.

### Changed

- The context gate and the context meter read one shared limit, so they cannot disagree.
- Model pricing is shown only when it is sourced: the OpenCode Go static rows carry no price and no
  context length instead of guesses.
- The numbers in `README.md` and `docs/environment.md` are generated from the measured artifacts by
  `scripts/render-env-tables.mjs`, and CI fails when they drift.
- Reference text that reaches the model is neutralised: a quoted document source loses its brackets
  and line breaks before it is wrapped into a prompt.
- The desktop end-to-end project is scoped by `testMatch`, so browser specs no longer run inside it
  and hide real desktop failures.

### Removed

- The dead embedding module `src/lib/rag/apiEmbedder.ts`: it had no importer and duplicated the live
  `embedder.ts` boundary (M8/T8.3, finding L1).
- The dead UI wrapper `src/components/ui/sonner.tsx`: it had no importer and read CSS variables the
  theme never emits; the toaster is mounted from `main.tsx` with the app's own token mapping
  (M8/T8.5, finding L3).
- The `next-themes` dependency: after `sonner.tsx` was deleted it had no importer (`src` and `dist`
  are both clean), so it was removed from `package.json` and the lockfile (M8/T8.5 follow-up, user
  decision).

### Fixed

- **NH-01 (HIGH) - semantic and hybrid document search returned noise.** The embedder fed the ONNX
  model tokens from a placeholder whitespace tokenizer with run-scoped, arbitrary ids, so Arabic
  queries could not produce meaningful vectors. The pipeline now uses the real tokenizer, the
  embedding identity (model plus tokenizer version) is persisted, and search is filtered by that
  identity through a Dexie v6 migration, so two vector spaces cannot mix.
- **NH-02 (HIGH) - the production desktop CSP disabled the whole RAG runtime.** `script-src 'self'`
  blocked WebAssembly and the CDN-hosted assets were unreachable. The runtime, tokenizer and model
  assets are now bundled and served locally, `'wasm-unsafe-eval'` is allowed for wasm only, and a
  desktop CSP/wasm smoke test proves both the fix and its teeth.
- Chat pipeline: the tool set and the step budget are decided in one place; a truncated stream is
  classified from its finish reason instead of a guessed end; cost is computed from the resolved
  model; cache-write tokens are read from the provider usage; one context limit is used everywhere.
- RAG: the scope filter is a real join by document id applied before ranking; the model cache has a
  single writer; document text that reaches a prompt is sanitised against delimiter injection.
- Localisation: persisted error text is stored as a stable key and translated at render; stored and
  archived text is written with the locale of its producer; cost formatting uses one helper.
- Accessibility: reflow at 320 px, the missing `main` landmark on the first-run screen, and the
  focus-ring artefact were fixed after measurement.
- **The temporary-file cleanup policy is now honoured.** The `after_turn` / `after_session` /
  `manual` setting was documented as delivered but nothing called the cleanup entry points, so
  temporary uploads accumulated. `after_turn` now runs in `persistTurn`'s `finally`, `after_session`
  runs when a session is left, and a startup sweep removes orphans unless the policy is `manual`
  (M8/T8.1, finding M1).
- **DOCX documents are ingested.** `extractDocxText` and the `mammoth` dependency existed but the
  file processor had no `docx` route and neither upload surface accepted the extension, so a DOCX
  was silently unsupported. The type is now routed, the dead `isDocxSupported` helper is gone, and
  `.docx` is accepted by both upload surfaces (M8/T8.2, finding M2).
- **Error text is redacted before it is logged.** `logging.ts` stored and printed the raw error
  string; it now passes the console text, the persisted `lastError.message` and the
  `unhandledrejection` reason through the single sanctioned redactor `redactExternalError`
  (M8/T8.4, finding L2).
- **The shortcut help dialog lists every real shortcut.** `Ctrl+Enter` (send) and `Ctrl+1`-`Ctrl+9`
  (focus target) worked but were missing from the in-app list; they are now shown as display-only
  rows, so the help matches the keys the app actually binds (T7.2 finding, resolved in T7.6).
- **The chat result chevron mirrors in Arabic.** It was always rotated one way; it now flips under
  RTL (`rtl:rotate-90`), so the expand indicator points the correct way in a right-to-left layout
  (T7.6).
- Low-backlog hardening with no user-visible behaviour change: the archive writer validates a stored
  `onDiskDir` before use, the composer truncates on code-point boundaries instead of splitting an
  emoji, the composer's empty draft object is frozen, a provider card's Test button is disabled when
  no static model exists, the key-check URL is built with the URL parser instead of string
  concatenation, the credential store caches its in-flight initialization, and the archive queue's
  counter is renamed `archiveQueueDirs` for what it actually counts (T7.6).

### Security

- Provider keys are never written to `localStorage` or to the settings record: on the desktop they go
  straight to the OS keychain through Tauri commands, and the web backend stores an AES-GCM record.
- No runtime network access beyond the configured provider; the RAG assets are served from the bundle.
- Dependency advisories are gated: `pnpm audit:check` fails on any advisory that is not registered
  with a written justification.

### Known limitations

- **The installer is unsigned.** `Get-AuthenticodeSignature` reports `Status: NotSigned`, so Windows
  SmartScreen shows an unknown publisher. What a user sees, and the future signing path, are in
  `docs/release-checklist.md` section 3.
- **Windows 10/11 x64 only.** Linux is a compile check in CI and produces no package, macOS has never
  been built, and no `.msi` is shipped (see `docs/release-checklist.md` section 2).
- **The packaged installer has been built and inspected, but it has only ever been installed on the
  development host.** An installed `0.1.0` copy is present there (an uninstall-registry entry whose
  `InstallLocation` is `%LOCALAPPDATA%\shura`, with `app.exe` and `uninstall.exe` dated 2026-09-25) and it has
  written 4 session archives under `Documents\Shura\sessions`; the previous wording of this item ('never installed
  and run on a user machine') was wrong. **What is still unproven:** an install on a clean external machine, and an
  upgrade or uninstall cycle - a human step (T5.3 Step 2, T6.5 Step 3).
- **The RAG path with the real embedding model is not covered automatically.** The check that downloads
  `multilingual-e5-small` and embeds plus searches a document is a pending opt-in run; the automated
  tests exercise the bundled runtime and the storage path, but not a real model download.
- **Live provider verification is complete for OpenCode Go only.** The provider-level checklist was executed
  on 2026-10-11 (review section 13), and on 2026-10-12 the opt-in `e2e/live` suite (T6.7) executed one real turn
  through the packaged desktop app: `longcat-2.5-preview-free` returned a non-empty answer with no provider error
  and rendered the usage footer (`pnpm test:e2e:live`, 1 passed in 9.9 s; `pnpm check:live-secrets` found 0 leaks).
  **OpenRouter, Gemini and MiniMax were not live-verified at the app level** - no credential exists for them here -
  so no PASS is claimed for those three.
- **The human accessibility pass is pending.** The automated pass is complete; the screen-reader, zoom
  and reduced-motion script in `docs/accessibility-manual-pass.md` still needs a person.
- **Eleven npm advisories are registered** as accepted with justification (see
  `scripts/audit-allowlist.json`), and some have no upstream fix. Any new advisory fails the gate.
- **`tokenizerVersion` is the pinned source string, not a content hash** of the tokenizer files, so a
  mutable upstream revision is not detected.
- **Desktop end-to-end tests run on a development machine only.** The Windows CI job packages the
  installer; a Windows desktop E2E job is blocked on a CI cost decision (T6.1 Step 3).
- **Residual hardcoded Arabic strings remain in non-UI layers** (persistence and parser/guard
  messages) under a documented lint exemption; T3.2 is PARTIALLY_COMPLETED.

### Milestones in this entry

| Milestone | Delivered |
|---|---|
| M0 - Truthful gates and instrumentation | Bundle-budget gate in `check:all`; 44 generated values in `README.md` and `docs/environment.md`; the desktop-E2E failure documented instead of hidden |
| M1 - RAG correctness (the release blockers) | Real tokenizer; embedding identity plus Dexie v6 with version-filtered search; local CSP-safe assets; document scope filter; delimiter neutralisation; one model-cache writer |
| M2 - Chat pipeline correctness | One tool/step budget; truncated-stream classification; cost from the resolved model; cache-write tokens; one context limit; authenticated catalog; no unsourced price; explicit reasoning state |
| M3 - i18n completeness | Keyed errors translated at render; producer-locale text; archive dates through `UiText`; one cost formatter; the Arabic-literal lint rule |
| M4 - Architecture and maintainability | `persistTurn` extracted out of `ChatScreen.tsx`; the file-budget guard test |
| M5 - Accessibility hardening | axe suite over the screen states; numeric token-contrast contract; reflow, landmark and focus-ring fixes; the human pass script |
| M6 - Packaging, desktop verification and release | Windows NSIS installer built and inspected (unsigned, `shura_0.1.0_x64-setup.exe`, 4,095,495 bytes, 2026-09-25); semver 0.1.0 in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`; `CHANGELOG.md` created; the desktop Playwright suite green through `cdp` (6 passed); the opt-in live suite (`pnpm test:e2e:live`, 1 passed in 9.9 s); `docs/release-checklist.md` with the release gate as a tick-list (section 5) and the backout record (section 6). Complete except T6.1 Step 3 - a Windows desktop-E2E CI job blocked on a cost decision |
| M7 - Post-review reconciliation | T7.1: the 2026-09-28 milestone file reconciled 60/60 boxes (31 implemented, 26 carried into T7.3-T7.6, 2 closed) with inline file:line evidence. T7.2: `pnpm docs:numbers:check` exit 0 and 18 stale claims corrected across `README.md`, `docs/environment.md`, `docs/troubleshooting.md` and `docs/user-guide.md`, every one re-checked by hand; Q6 resolved (reviews stay local). T7.3 one redactor; T7.4 usage salvage; T7.5 persistence tests; delivered 2026-10-12. T7.6 (2026-10-16): the 2026-09-28 milestone-7 Low backlog reconciled - 20 items, 11 fixed and 9 recorded `accepted - Low`, plus the shortcut-help finding; `pnpm check:all` PASS |
| M8 - Review reconciliation (2026-10-16) | A read-only review of the uncommitted hardening tree returned PASS WITH CONCERNS; all six findings fixed - the temp-cleanup policy is wired, DOCX is routed, the dead `apiEmbedder` and `sonner` modules are deleted, error text is redacted at the logging sink, and summary persistence is extracted out of `useSummaryExtraction.ts` (M8/T8.1-T8.6) |
