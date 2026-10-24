# Dependency advisories - accepted-risk register

```
Register for:   scripts/check-audit.mjs   (run: pnpm audit:check)
Baseline:       2026-10-05
Raw evidence:   pnpm audit --json      -> exit 1, 11 advisories (1 critical, 5 high, 5 moderate)
                pnpm audit --prod --json -> exit 1, 1 moderate (sprintf-js via mammoth)
Scope:          every advisory reported by pnpm audit must have a row here with a
                justification and an unexpired re-review date, or the gate fails.
```

## Why this file exists

`docs/environment.md` used to claim "zero vulnerabilities" from a `pnpm audit --json`
run that returned exit 0. That claim is stale: the same command now reports 11
advisories. Rather than weaken the claim or silently ignore it, every advisory is
recorded below with the reason it is (or is not) reachable, so "we know about these"
is a reproducible statement instead of a hopeful one.

## How to use it

- `pnpm audit:check` runs the audit, then fails if any reported advisory has no row
  here, or if any row's re-review date has passed.
- Adding a row means answering: which package, which path pulls it in, is that path in
  the shipped production graph, what is the upstream fix, and what did we decide.
- Decisions: `fix` (pin/override/upgrade), `replace` (swap the dependency), `accept`
  (documented risk, with a re-review date). Never `accept` a production-path advisory
  without a stated mitigation.
- Re-review date: three months out for accepted risk in the production graph, twelve
  months for dev-only tooling. When the date passes, the gate fails until the row is
  re-examined - that is intentional.

## Advisories

Production? answers whether the advisory sits on a path that is bundled into `dist/`.
Severity is the npm advisory severity, not our own.

| ID | Package | Severity | Production? | Path | Upstream fix | Decision | Re-review |
|---|---|---|---|---|---|---|---|
| 1241210 | proxy-addr | critical | no (dev toolchain) | shadcn > @modelcontextprotocol/sdk > express > proxy-addr | >=2.0.8 | accept - the shadcn CLI runs at development time only and nothing from it ships in dist/ | 2027-10-05 |
| 1241339 | @modelcontextprotocol/sdk | high | no (dev toolchain) | shadcn > @modelcontextprotocol/sdk | >=1.31.0 | accept - same reasoning; clears when shadcn bumps its SDK | 2027-10-05 |
| 1240992 | braces | high | no (dev toolchain) | shadcn > fast-glob > micromatch > braces | none published | accept - no fixed version exists; dev-only, and it is never fed untrusted glob patterns | 2027-04-05 |
| 1241209 | source-map-js | high | no (build only) | @tailwindcss/vite > @tailwindcss/node > source-map-js | >=1.2.2 | accept - build-time only; source maps are produced from our own sources, not attacker input | 2027-10-05 |
| 1240103 | brace-expansion | moderate | no (dev toolchain) | @eslint/js > eslint > @eslint/config-array > minimatch > brace-expansion | >=5.0.12 | accept - lint expands globs over trusted repository paths only | 2027-10-05 |
| 1240107 | brace-expansion | high | no (dev toolchain) | @eslint/js > eslint > @eslint/config-array > minimatch > brace-expansion | >=5.0.11 | accept - same path and reasoning as 1240103 | 2027-10-05 |
| 1240111 | brace-expansion | high | no (dev toolchain) | @eslint/js > eslint > @eslint/config-array > minimatch > brace-expansion | >=5.0.10 | accept - same path and reasoning as 1240103 | 2027-10-05 |
| 1240091 | fast-uri | moderate | no (dev toolchain) | shadcn > @dotenvx/dotenvx > conf > ajv > fast-uri | >=3.1.8 | accept - dev-only configuration parsing | 2027-10-05 |
| 1240097 | ip-address | moderate | no (dev toolchain) | shadcn > @modelcontextprotocol/sdk > express-rate-limit > ip-address | >=10.7.1 | accept - dev-only; clears with the same shadcn bump as 1241339 | 2027-10-05 |
| 1240098 | ip-address | moderate | no (dev toolchain) | shadcn > @modelcontextprotocol/sdk > express-rate-limit > ip-address | >=10.7.1 | accept - same path and reasoning as 1240097 | 2027-10-05 |
| 1241202 | sprintf-js | moderate | **yes - bundled** | mammoth > argparse > sprintf-js | none published | accept with mitigation - see below | 2027-04-05 |
| 1243066 | zod | high | no (dev toolchain) | shadcn > @modelcontextprotocol/sdk > zod (3.25.76) | >=4.6.6 (no 3.x fix) | accept - the shadcn CLI pins zod 3 and runs at development time only; the runtime zod is 4.x and is overridden to >=4.6.6 | 2027-10-24 |

### 1241202 - the only production-path advisory

- **What it is:** unbounded precision in `sprintf-js` lets a crafted format string
  consume disproportionate CPU (denial of service).
- **How it is reached:** `mammoth` depends on `argparse`, which depends on
  `sprintf-js`. `argparse` is mammoth's command-line entry point.
- **Why the app does not trigger it:** Shura calls the mammoth **library** API only -
  `mammoth.extractRawText` in the DOCX extractor - passing a user-selected file and no
  format string. `argparse` is never invoked, so no attacker-controlled format string
  reaches `sprintf`, and the vulnerable entry point is unreachable through the
  application's own code path.
- **Why it is still recorded as production-path risk:** the package is present in the
  bundled dependency graph; the mitigation is an argument about reachability, not a
  fix. That is exactly the kind of claim that should expire and be re-checked.
- **Upstream status:** no patched version is published. Re-check on the re-review date
  and replace `mammoth` if it remains unpatched or if DOCX handling changes to invoke
  the CLI path.
- **Re-review:** 2027-04-05 (three months out, because the path is in the production graph).

## Override evaluation (T0.1 Step 3)

The plan asks for the cheap fixes to be attempted before accepting risk. Result:

- `pnpm why sprintf-js` -> single version 1.0.3, reached only as
  `mammoth -> argparse -> sprintf-js`, and the advisory has **no published fix**.
  There is therefore no fixed version to pin to; the only real remedies are replacing
  `mammoth` or changing the DOCX path, neither of which is justified for an
  unreachable entry point. Decision stands as accept-with-mitigation.
- `pnpm why braces` -> 3.0.3, reached through `shadcn -> fast-glob -> micromatch > braces`
  (also via `shadcn -> ts-morph`). This advisory also has **no published fix**.
- The remaining nine advisories are all dev/build-toolchain paths (`shadcn`, `@eslint/js`,
  `@tailwindcss/vite`). Forcing their transitive versions with `pnpm.overrides` would push
  packages outside the range their parents declare, risking a broken lint or CLI toolchain
  for zero benefit to shipped code. Not attempted, deliberately and on the record.
- Confirmed by reading `package.json`: `mammoth` is a **runtime** dependency (so 1241202 is
  a genuine production-graph row); `shadcn`, `@eslint/js` and `@tailwindcss/vite` are
  **devDependencies**, which is why the other ten rows are marked dev/build only.

## Update 2026-10-24 - overrides applied

The audit now reported 15 further advisories (vite, zod, undici, body-parser, hono), several
on the production graph (zod and undici through `@ai-sdk/*`). The earlier "not attempted"
position was revisited: `pnpm-workspace.yaml` now carries `overrides`, each scoped to the
vulnerable range and pinned to the patched release **within the same major**, so no parent
is pushed outside the semver range it declares. Direct deps `vite` (^8.2.4) and `zod`
(^4.6.6) were bumped in `package.json`. Result: every row above except 1243066 is no longer
reported (braces and sprintf-js have also left the graph), and the production graph has
zero advisories. The older rows are kept as history; the gate only requires that reported
advisories are registered.

## Measured evidence

| Date | Command | Result |
|---|---|---|
| 2026-10-05 | `pnpm audit --json` | exit 1 - 11 advisories: 1 critical, 5 high, 5 moderate |
| 2026-10-05 | `pnpm audit --prod --json` | exit 1 - 1 moderate (1241202 sprintf-js) |
| 2026-10-05 | `pnpm audit:check` | PASS - all 11 advisories registered, no re-review date passed |
| 2026-10-24 | `pnpm audit:check` (after overrides) | 1 advisory (1243066, dev-only zod 3); production: 0 |
