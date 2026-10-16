# Shura release checklist

**Status:** sections 1-3 are written (T6.3, T6.4 Step 2, T6.5 Step 3); section 4 carries the gate
results (T6.6-T6.8); sections 5-6 are the release tick-list and the backout, written by T6.8 of
`docs/plans/2026-10-05-production-readiness-plan.md`. Nothing in this file is a result until a row
carries a measured value and a date.
**Build under test:** `__` - copy the entry hash from `dist/assets/index-*.js` and the installer version.
**Ran by / date:** `__`

## 1. Packaging targets (T6.3, decided 2026-10-12)

| Step | Command | Artifact it proves | Gate |
|---|---|---|---|
| Web bundle | `pnpm build` | `dist/index.html` and `dist/assets/*` | `pnpm check:bundle` - base entry at or under 1,200,000 bytes |
| Desktop build | `pnpm tauri:build:windows` (= `pnpm tauri build --bundles nsis`) | `src-tauri/target/release/app.exe` | exit 0 |
| Installer | same command | `src-tauri/target/release/bundle/nsis/shura_0.1.0_x64-setup.exe` | exit 0 |
| MSI | **not shipped** | - | see the decision below |

- **Decision (Q3 + Q4):** the only shipped artifact for this release is the **NSIS** installer and it is **unsigned**.
- **Why no `.msi`:** the WiX 3 target needs `light.exe`, which requires **.NET Framework 3.5**; it is absent on this
  host and is not added to CI, so the default `all` target fails at MSI and `src-tauri/target/release/bundle/msi`
  stays empty (measured 2026-10-12: 0 files). The usual reason to prefer `.msi` (enterprise deployment) does not
  apply while the installer is unsigned.
- **To add `.msi` later:** install .NET Framework 3.5 (or WiX 4, which does not need it) and run
  `pnpm tauri build --bundles nsis,msi`; no application code change is required, because the target is chosen on
  the command line. Add the row here when it is green.
- **Recorded limitation (corrected 2026-10-12):** the installer was produced and inspected, and an installed
  copy **does** exist on the development host. Measured: `HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall`
  holds a `shura` `0.1.0` entry whose `InstallLocation` is `%LOCALAPPDATA%\shura`; that directory holds `app.exe`
  (`FileVersion 0.1.0`, 2026-09-25 19:52:20) and `uninstall.exe` (2026-09-25 21:01:08); and `Documents\Shura\sessions`
  holds 4 session archives written by that copy. The earlier sentence 'not installed and run on a user machine' was
  wrong and is superseded. What is still unproven is an install on a **clean external machine** and an
  uninstall/upgrade cycle (neither was run here - running the uninstaller would remove the copy on this host, which
  is not authorized): a human gate (T5.3 Step 2, T6.5 Step 3, gate A4 in section 5.1).

## 2. Supported platforms (T6.4 Step 2, 2026-10-12)

| Platform | Status for this release | Evidence |
|---|---|---|
| Windows 10/11 x64 | **Supported and shipped** | NSIS installer built on the dev host and in CI (`.github/workflows/ci.yml`, job `nsis`, `pnpm tauri:build:windows`); WebView2 is present on Windows 10/11 by default |
| Linux x64 | **Not supported; compile check only** | CI installs the WebKitGTK packages and runs `cargo fmt --check`, `cargo check --locked` and `cargo test --locked` on `ubuntu-latest` (job `rust`); there is no `tauri build` job and no Linux package is produced |
| macOS | **Not supported; never built** | no CI job, no packaging target, no tested runtime |

- The web bundle (`dist/`) is platform-independent, but the shipped product is the desktop app, so the desktop
  matrix above is the claim that matters.
- The README and the release notes must not claim Linux or macOS support while this table stands.

## 3. Signing status (T6.5 Step 3, 2026-10-12)

- **No code-signing certificate is available** (Q4, answered 2026-10-05), so the installer ships **unsigned**.
  Nothing in the build wires a signature: `src-tauri/tauri.conf.json` has no `bundle.windows.certificateThumbprint`
  and no `signCommand`, and CI holds no signing secret.
- **Measured:** `Get-AuthenticodeSignature src-tauri/target/release/bundle/nsis/shura_0.1.0_x64-setup.exe` returns
  `Status: NotSigned`. The file inspected is the 2026-09-25 build; the build config contains no signing step at
  all, so a fresh build is unsigned in the same way.
- **What a user sees:** an installer downloaded from the internet carries the Mark-of-the-Web, so Windows
  SmartScreen shows "Windows protected your PC" with an unknown publisher and hides the installer behind
  *More info* then *Run anyway*. A copy run from local disk or a network share may not show that prompt, which
  makes the friction inconsistent rather than absent.
- **Consequences accepted with this release:** a user cannot verify the installer's authenticity or integrity,
  SmartScreen friction lowers install completion, and enterprise deployment (Group Policy, `.msi`) is unavailable
  - see section 1.
- **If signing is added later:** obtain a certificate (OV/EV or Azure Trusted Signing), wire `bundle.windows` or
  the CI secret equivalent, rebuild, and re-measure with `Get-AuthenticodeSignature`; replace this section with the
  `Valid` result instead of deleting the history above.

## 4. Gate results

- [x] **T6.6 - version, changelog and known limitations (2026-10-12).** `package.json`, `src-tauri/Cargo.toml` and
      `src-tauri/tauri.conf.json` all declare `0.1.0`; `CHANGELOG.md` carries one `## [Unreleased] - version 0.1.0`
      entry for M0-M5 with the known limitations. **No git tag and no release were created** (tags only on request).
- [x] **T6.7 - live provider verification (2026-10-12): OpenCode Go PASS, three providers BLOCKED.**
      `pnpm test:e2e:live` -> 1 passed (9.9 s) against the packaged desktop app (`src-tauri/target/debug/app.exe`
      over WebView2 CDP on `http://tauri.localhost/`): one real turn on `longcat-2.5-preview-free` returned a
      non-empty answer with **no** provider error and rendered the usage footer (`usageRecorded=true`, from the test
      annotation; test 6.3 s, run 9.9 s). `pnpm check:live-secrets` after the real run found **0 leaks** with the real
      key in scope. **BLOCKED for OpenRouter, Gemini and MiniMax:** no credential exists for them on this machine, so
      no app-level turn was executed and no PASS is claimed (plan T6.7 Step 5).
- [x] **T6.8 - the full tick-list mapped to the definition of production ready, plus the backout section
      (2026-10-12).** Sections 5 (the gate, mapped to the seven points of the plan's definition, with the exact
      command and artifact per row) and 6 (backout and downgrade) below. Writing it corrected a wrong claim about
      the installer (section 1) and recorded the candidate facts in section 5.2.

## 5. The release gate - 'production ready' as a tick-list (T6.8 Step 1)

The plan's definition (`docs/plans/2026-10-05-production-readiness-plan.md`, 'Definition of production
ready (the release gate)') has seven points. Each is one row below, with the exact command, the artifact it
proves, and the status measured on 2026-10-12 against the current working tree. A row is PASS only when the
command was run against the build being shipped; open rows must not be ticked by inference.

- [x] **Point 1 - the whole gate suite passes.** Command: `pnpm check:all`. Proves: typecheck, lint, unit
      tests with coverage, `vite build`, the 1,200,000-byte base-entry budget and the advisory register, in one
      exit code. **PASS 2026-10-12:** exit 0; base entry 1,108,374 B of 1,200,000 (headroom 91,626 B).
- [x] **Point 2 - the browser and desktop suites pass.** Commands: `pnpm test:e2e:browser` and
      `pnpm test:e2e:desktop`. Proves: the shipped UI in Chromium against a real `dist/`, and the same code
      inside the packaged app under the production CSP (the launcher runs `--project=tauri`, which is `cdp`
      mode on Windows - `tauri` mode cannot work with `@srsholmes/tauri-playwright@0.4.1` on Windows; that is
      the documented substitute). **PASS 2026-10-12:** browser 24 passed; desktop 6 passed (18.7 s).
- [ ] **Point 3 - the desktop smoke covers first run, a real provider turn, and a document upload that reaches
      a search result.** Commands: `pnpm test:e2e:desktop` (first run, CSP/wasm) plus the live RAG run.
      **PARTIAL, 2026-10-12:** first run PASS and the real provider turn PASS (point 2 and gate A1 below);
      **the upload -> embed -> search path has NOT been run** - it needs the 130 MB `multilingual-e5-small`
      download (T6.2 Step 1 residual, `TASKS.md` `## Waiting On`). Do not tick this row before that run exists.
- [x] **Point 4 - the documentation numbers match the build.** Command: `pnpm docs:numbers:check` (CI also runs
      `pnpm docs:numbers && git diff --exit-code`). Proves: every value inside the generated spans of `README.md`
      and `docs/environment.md` is the one this build produces, and `CHANGELOG.md` exists for the shipped
      version. **PASS 2026-10-12:** exit 0, no drift.
- [x] **Point 5 - no unregistered advisory of moderate severity or worse.** Command: `pnpm audit:check`. Proves:
      every reported advisory is a row in `docs/security/dependency-advisories.md` and no re-review date has
      passed. **PASS 2026-10-12:** 11 advisories registered; the production graph has 1 moderate, registered.
- [ ] **Point 6 - this checklist is fully ticked.** Proves: a human read every row and no gate passes by
      inference. **NOT YET:** point 3, gate A3, gate A4 and this row are open.
- [x] **Point 7 - no provider displays an unsourced price.** Proves: T2.9 deleted every hardcoded OpenCode Go
      rate, so an unpriced model renders the no-value glyph instead of a fabricated `$0.000000`. **PASS for
      OpenCode Go 2026-10-12.** The plan's headline reads 'no provider' while its parenthetical scopes the rule
      to OpenCode Go; `google`/`minimax` (and `openrouter`'s static fallback) still display hand-written rates
      with no attribution. **Q7 is open** - if the headline is authoritative, this row is not PASS until Q7 is
      answered (`TASKS.md` `## Waiting On`).

### 5.1 Gates the plan mandates outside the seven points

- [x] **A1 - one real provider turn through the app (M6/T6.7).** Command: `pnpm test:e2e:live` (opt-in, never in
      CI; a missing key is SKIPPED, not FAIL). Proves: a real request from the packaged app to a real provider,
      a non-empty answer, no provider error, and the usage footer. **PASS for OpenCode Go 2026-10-12** (1 passed,
      9.9 s, `usageRecorded=true`). **BLOCKED for OpenRouter, Gemini and MiniMax** (no credential here) -
      section 4.
- [x] **A2 - the automated accessibility half (M5/T5.1, T5.2).** Commands: `pnpm test:e2e:browser`
      (`e2e/axe.spec.ts`, 8 states in both themes) and `pnpm test`. Proves: no axe violation in the tested states
      and the 47-pair token contrast contract. **PASS 2026-10-12** (inside the 24 browser tests and
      `pnpm check:all`).
- [ ] **A3 - the human accessibility pass (M5/T5.3 Step 2).** Artifact: the signed table in
      `docs/accessibility-manual-pass.md` (33 checks). **NOT RUN:** needs a human at a GUI; not claimable
      without the run.
- [ ] **A4 - installer smoke on a clean machine (T6.5 Step 3).** Proves: the NSIS installer installs, the app
      starts, and an upgrade/uninstall behaves. **PARTIAL and corrected:** an installed `0.1.0` copy exists on
      the development host (section 1), so the installer does install and the installed app has written data;
      **no clean external machine and no uninstall cycle** were exercised.
- [ ] **A5 - the candidate is cut from the current tree.** **NOT YET:** the only installer on disk is the
      2026-09-25 build (5.2), and the tree has changed since (T1.x-T6.x), so a release must rebuild and re-run
      every row above against the new artifact.

### 5.2 Facts about the current candidate (measured 2026-10-12)

- Version `0.1.0` in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`; **no git tag and
  no release** exists (`git tag --list` is empty).
- The only installer on disk is `src-tauri/target/release/bundle/nsis/shura_0.1.0_x64-setup.exe`
  (4,095,495 B, 2026-09-25 19:52:31, `Status: NotSigned`); `bundle/msi` is empty. That build predates the whole
  hardening plan, so it is **not** a release candidate.
- The copy installed on the development host is that same build (`%LOCALAPPDATA%\shura\app.exe`,
  `FileVersion 0.1.0`, 2026-09-25 19:52:20), and it has written 4 session archives to
  `Documents\Shura\sessions`.
- The E2E suites pick the newest `app.exe` under `src-tauri/target/`, which is currently the `debug` build.

## 6. Backout and downgrade (T6.8 Step 2)

### 6.1 Withdrawing a build

- There is no update channel to reach: `src-tauri/tauri.conf.json` wires no updater plugin, the app has no
  backend and sends no telemetry, and the shipped artifact is one unsigned NSIS installer. 'Publishing' is
  putting that file where a user can download it.
- To withdraw: delete the artifact (and the release page, if one was created - none exists for 0.1.0), add a
  withdrawal entry to `CHANGELOG.md`, bump the patch version, and re-issue. Installed copies keep working: they
  never check for updates.
- Nothing server-side can be revoked. The only secrets in play are the user's own provider keys, which live in
  the OS keychain on the user's machine and are sent to nobody but the provider; if a key is believed exposed,
  the user rotates it at the provider.
- The version bump touches three files that must stay in step: `package.json`, `src-tauri/Cargo.toml`,
  `src-tauri/tauri.conf.json`.

### 6.2 Downgrading the app (older build, newer data)

- **Local database (Dexie/IndexedDB), `src/lib/db/db.ts`:** the schema is at **v6**. Versions 3-6 are additive
  (new tables and indexes; v6 adds the `embeddingVersion` index, and old chunks simply carry no stamp and are
  treated as stale); v2 is not purely additive - its upgrade step backfills every `sessions` and `usage_events`
  row (`contextMode`, `targets`, `cacheWriteInputTokens`).
- **What a downgrade does:** Dexie refuses to open a database whose stored version is higher than the version
  the code declares - it throws `VersionError`. **No handler for that error exists anywhere in `src`**
  (measured: 0 matches), so an older build is expected to fail at the first database access rather than
  silently drop data - but that has **not been exercised**, because 0.1.0 is the first release and no older
  build exists to run. A failed open does not delete the local database; a user recovers by reinstalling the
  newer build, or - losing local chat history - by deleting the WebView2 profile (see 6.3).
- **Session archives on disk (`<Documents>\Shura\sessions\<id>\meta.json`), `src/lib/markdown/writer.ts`:**
  the writer stamps `ARCHIVE_SCHEMA_VERSION = 2` (line 289). The reader validates a `schemaVersion: 2` manifest
  and **also** accepts a manifest with no `schemaVersion` at all, normalizing it as legacy v1 (lines 362-363) -
  so this build reads archives written by the pre-v2 code. The reverse (an older build reading a v2 archive) has
  no branch in that older code and is **unverified**.
- **Graceful degradation already in place:** a corrupt or oversized archive is quarantined rather than crashing
  startup (`src/lib/hardening.spec.ts`), so an unreadable archive is preserved, not deleted.
- **Risk window:** because 0.1.0 is the first public release, there is no released older build a user can
  downgrade to. This section becomes load-bearing from the second release onward; re-measure it then against the
  actual previous installer.

### 6.3 Where the data lives (for a manual backout)

| Data | Location | Removed by the uninstaller? |
|---|---|---|
| Installed program + uninstaller | `%LOCALAPPDATA%\shura` | yes - it is the install directory |
| Local database, WebView2 profile, cookies, logs | `%LOCALAPPDATA%\app.shura.local` (`EBWebView`, `logs`, `.cookies`) | **no** - not verified by running the uninstaller (that would remove the copy on this host); by construction the NSIS template removes the install directory and its registry/Start-menu entries only |
| Session archives (`meta.json`, Markdown, results) | `<Documents>\Shura\sessions` | **no** - they are user documents |
| Provider keys | Windows Credential Manager | **no** |

Every path above exists on this host and was listed on 2026-10-12; the uninstall behaviour was not exercised.
