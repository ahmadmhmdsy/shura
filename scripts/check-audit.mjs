#!/usr/bin/env node
/**
 * Dependency audit gate.
 *
 * Fails unless every advisory reported by `pnpm audit` has a row in the accepted-risk
 * register (docs/security/dependency-advisories.md) with an unexpired re-review date.
 *
 * Usage:
 *   node scripts/check-audit.mjs
 *   node scripts/check-audit.mjs --register <path>
 *   node scripts/check-audit.mjs --audit-json <file> --audit-prod-json <file> [--skip-prod]
 *
 * Exit codes: 0 = pass, 1 = gate failure, 2 = the audit could not be measured.
 * A gate that cannot measure must never report success.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_REGISTER = "docs/security/dependency-advisories.md";
const args = process.argv.slice(2);

function option(name, fallback) {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
}

const registerPath = path.resolve(option("--register", DEFAULT_REGISTER));
const auditJsonPath = option("--audit-json", null);
const auditProdJsonPath = option("--audit-prod-json", null);
const skipProd = args.includes("--skip-prod");

function fail(message) {
  console.error("FAIL: " + message);
  process.exit(2);
}

function runAudit(extra) {
  // On Windows pnpm is a .cmd shim, which child_process cannot execute directly,
  // so the call goes through the shell there. Every argument is a static literal
  // (see call sites), so there is no user input for the shell to misinterpret.
  const result = spawnSync("pnpm", ["audit", "--json"].concat(extra), {
    encoding: "utf8",
    maxBuffer: 67108864,
    shell: process.platform === "win32",
  });
  if (result.error) fail("could not run pnpm audit: " + result.error.message);
  // pnpm audit exits 1 when advisories exist; the JSON is still on stdout.
  const out = result.stdout || "";
  if (out.indexOf("{") !== -1) return out;
  fail("pnpm audit did not return JSON. REASON: " + String(result.stderr || "").trim().slice(0, 400));
}

// A missing or unreadable input is "cannot measure", not "gate failed": it must exit 2 with a
// clean message rather than surfacing a Node stack trace that looks like a crash.
function readTextFile(filePath, label) {
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    fail("cannot read the " + label + " at " + filePath + " (" + error.code + ")");
  }
}

function parseAudit(raw, label) {
  const start = raw.indexOf("{");
  if (start === -1) fail("no JSON object in the " + label + " audit output");
  try {
    return JSON.parse(raw.slice(start));
  } catch (error) {
    fail("the " + label + " audit output is not valid JSON: " + error.message);
  }
}

function advisoriesOf(data) {
  const map = new Map();
  const list = data && data.advisories ? Object.values(data.advisories) : [];
  for (const item of list) {
    const findings = item.findings || [];
    const firstPath = (findings[0] && findings[0].paths && findings[0].paths[0]) || "";
    map.set(String(item.id), {
      id: String(item.id),
      module: item.module_name,
      severity: item.severity,
      path: firstPath,
    });
  }
  return map;
}

function severitySummary(data) {
  const v = (data && data.metadata && data.metadata.vulnerabilities) || {};
  return ["critical", "high", "moderate", "low", "info"]
    .map(function (k) { return k + "=" + (v[k] || 0); })
    .join(" ");
}

const allData = auditJsonPath ? parseAudit(readTextFile(auditJsonPath, "all-deps audit JSON"), "all-deps") : parseAudit(runAudit([]), "all-deps");
let prodData = null;
if (auditProdJsonPath) prodData = parseAudit(readTextFile(auditProdJsonPath, "production audit JSON"), "production");
else if (!skipProd) prodData = parseAudit(runAudit(["--prod"]), "production");

const allAdvisories = advisoriesOf(allData);
const prodAdvisories = prodData ? advisoriesOf(prodData) : new Map();

const registerText = readTextFile(registerPath, "advisory register");
const registered = new Map();
const malformed = [];
for (const line of registerText.split("\n")) {
  if (line.charAt(0) !== "|") continue;
  const cells = line.split("|").map(function (c) { return c.trim(); });
  const id = cells[1];
  if (!/^[0-9]{7}$/.test(id || "")) continue;
  const reReview = cells[cells.length - 2];
  registered.set(id, reReview);
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(reReview || "")) {
    malformed.push(id + " (malformed re-review date: " + reReview + ")");
  } else if (new Date(reReview + "T00:00:00Z").getTime() < Date.now()) {
    malformed.push(id + " (re-review was due " + reReview + ")");
  }
}

const unregistered = [];
for (const advisory of allAdvisories.values()) {
  if (!registered.has(advisory.id)) unregistered.push(advisory);
}
for (const advisory of prodAdvisories.values()) {
  if (!registered.has(advisory.id) && !unregistered.some(function (a) { return a.id === advisory.id; })) {
    unregistered.push(advisory);
  }
}

console.log("Dependency audit gate");
console.log("  register  : " + path.relative(process.cwd(), registerPath));
console.log("  all deps  : " + allAdvisories.size + " advisories (" + severitySummary(allData) + ")");
console.log("  production: " + (prodData ? prodAdvisories.size + " advisories (" + severitySummary(prodData) + ")" : "not measured (--skip-prod)"));
console.log("  registered: " + registered.size + " rows");

let failed = false;
if (registered.size === 0) {
  console.error("FAIL: the register has no advisory rows; refusing to pass.");
  failed = true;
}
if (unregistered.length > 0) {
  console.error("FAIL: " + unregistered.length + " reported advisory(ies) are not registered:");
  for (const a of unregistered) {
    console.error("  - " + a.id + " [" + a.severity + "] " + a.module + "  path: " + a.path);
  }
  failed = true;
}
if (malformed.length > 0) {
  console.error("FAIL: " + malformed.length + " register row(s) need attention:");
  for (const m of malformed) console.error("  - " + m);
  failed = true;
}

if (failed) {
  console.error("FAIL: dependency audit gate");
  process.exit(1);
}
console.log("PASS: every reported advisory is registered and no re-review date has passed.");
process.exit(0);
