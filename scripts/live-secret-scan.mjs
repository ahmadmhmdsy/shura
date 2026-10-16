#!/usr/bin/env node
/**
 * [T6.7 Step 3] Proves the live seam does not leak the key into test artifacts.
 *
 * Playwright writes traces, screenshots, videos and an HTML report under
 * test-results/ and playwright-report/. The live project runs with all three
 * capture modes off, and this scan is the check on that claim: it reads every
 * secret value in memory, searches the artifact bytes for it, and prints only
 * file names and counts - never a value and never a matching line.
 *
 * Usage:
 *   pnpm check:live-secrets
 *   SHURA_LIVE_NO_DOTENV=1 pnpm check:live-secrets   # environment values only
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

if (process.env.SHURA_LIVE_NO_DOTENV !== "1" && existsSync(".env")) {
  try {
    process.loadEnvFile(".env");
  } catch {
    // An unreadable .env only means fewer values to scan; the env vars still count.
  }
}

const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASSWD/i;
const secrets = Object.entries(process.env)
  .filter(([name, value]) => SECRET_NAME.test(name) && typeof value === "string" && value.trim().length >= 8)
  .map(([, value]) => Buffer.from(String(value), "utf8"));

const roots = ["test-results", "playwright-report"].filter(existsSync);
const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else files.push(path);
  }
};
for (const root of roots) walk(root);

const leaks = [];
for (const file of files) {
  const bytes = readFileSync(file);
  if (secrets.some((secret) => bytes.includes(secret))) leaks.push(file);
}

console.log("[live-secret-scan] secrets in scope: " + secrets.length + ", artifact files: " + files.length + ", leaks: " + leaks.length);
for (const leak of leaks) console.log("[live-secret-scan] LEAK in " + leak);
process.exitCode = leaks.length === 0 ? 0 : 1;
