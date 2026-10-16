#!/usr/bin/env node
/**
 * Runs the opt-in live provider suite (T6.7) against the packaged desktop app.
 *
 * Two things make this different from pnpm test:e2e:desktop:
 *   1. it turns the live switch on, and that switch is the only way the live
 *      Playwright project exists (see playwright.config.ts), so neither CI nor a
 *      default run can collect these specs; and
 *   2. it may load the local .env, which is gitignored and untracked, so the
 *      OpenCode Go key does not have to be duplicated into a second variable.
 *
 * The key value is never printed. Only variable names and whether they are
 * present are reported; nothing is copied into a fixture, a trace or a report.
 *
 * Usage:
 *   pnpm test:e2e:live
 *   SHURA_LIVE_NO_DOTENV=1 pnpm test:e2e:live   # prove the gate: no key -> SKIPPED
 *   pnpm test:e2e:live --grep opencode         # extra args reach Playwright
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

if (process.env.SHURA_LIVE_NO_DOTENV !== "1" && existsSync(".env")) {
  try {
    process.loadEnvFile(".env");
    console.log("[e2e-live] loaded .env (values are never printed)");
  } catch (error) {
    console.error("[e2e-live] could not load .env: " + (error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

const KEY_VARS = [
  "SHURA_LIVE_OPENCODE_KEY",
  "OPENCODE_API_KEY",
  "SHURA_LIVE_OPENROUTER_KEY",
  "SHURA_LIVE_GEMINI_KEY",
  "SHURA_LIVE_MINIMAX_KEY",
];
const present = KEY_VARS.filter((name) => (process.env[name] ?? "").trim().length > 0);
console.log(
  "[e2e-live] key variables present: " +
    (present.length > 0 ? present.join(", ") : "none - every live test will be SKIPPED"),
);

const child = spawn(process.execPath, ["scripts/e2e-desktop.mjs", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, SHURA_LIVE_E2E: "1", TAURI_E2E_PROJECT: "live" },
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
