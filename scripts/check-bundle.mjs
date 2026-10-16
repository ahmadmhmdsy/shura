#!/usr/bin/env node
// Bundle budget gate (plan T0.2, decision D7).
//
// The budget is byte-based: the base entry JS referenced by dist/index.html must stay at or
// under 1,200,000 bytes. Vite prints 1000-based kB, this script measures real bytes, so the two
// numbers can never be confused. The chunkSizeWarningLimit in vite.config.ts stays advisory.
//
// Usage:
//   node scripts/check-bundle.mjs                    gate the current dist/
//   node scripts/check-bundle.mjs --budget 1000000   prove the failure direction
//   node scripts/check-bundle.mjs --dist other/dist  gate another build directory

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const BUDGET_BYTES = 1_200_000;
// If one of these stops being emitted as its own chunk, the split has regressed and the base
// entry has quietly absorbed the code, so the gate fails instead of reporting a smaller base.
const EXPECTED_CHUNKS = ["pdf-", "ort.wasm.bundle.min-", "rag-tool-", "rag-embedder-", "tokenizers-"];
// T1.3 (القرار D3، ADR 0004): الأصول التنفيذية تُحزم محليًا. وجود الملف في dist لا
// يكفي - يجب أن يشير إليه الـJS المُصدَر، وإلا كان وزنًا ميتًا وعاد السحب من الشبكة.
const EXPECTED_ASSETS = [
  { label: "pdf-worker", pattern: /^pdf\.worker\.min-.*\.mjs$/ },
  { label: "ort-wasm", pattern: /^ort-wasm-simd-threaded-.*\.wasm$/ },
  { label: "ort-glue", pattern: /^ort-wasm-simd-threaded-.*\.mjs$/ },
];

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

function unmeasurable(reason) {
  console.error("SKIPPED: " + reason);
  process.exit(2);
}

function fail(reason) {
  console.error("FAIL: " + reason);
  console.error("FAIL: bundle budget gate");
  process.exit(1);
}

const budget = (() => {
  const raw = argValue("--budget");
  if (raw === null) return BUDGET_BYTES;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || Math.floor(value) !== value) {
    unmeasurable("--budget must be a positive whole number of bytes, got " + raw);
  }
  return value;
})();

const distDir = path.resolve(argValue("--dist") ?? "dist");
const indexPath = path.join(distDir, "index.html");
const label = path.relative(process.cwd(), distDir) || ".";

if (!existsSync(indexPath)) unmeasurable(label + " has no index.html - run pnpm build first");

const html = readFileSync(indexPath, "utf8");
const entries = [...html.matchAll(/<script[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/gi)].map((m) => m[1]);
if (entries.length === 0) fail(label + "/index.html references no module script, so there is nothing to measure");
if (entries.length > 1) fail(label + "/index.html references " + entries.length + " module scripts; the gate expects exactly one base entry");

const entryUrl = entries[0];
const entryPath = path.join(distDir, entryUrl.replace(/^\//, ""));
if (!existsSync(entryPath)) fail("the entry referenced by index.html is missing: " + entryUrl);
const baseBytes = statSync(entryPath).size;

// Informational: index.html also modulepreloads the split chunks, so they are fetched at
// startup even though they are separate files. That total is reported but not gated yet -
// the release decision in D7 is about the base entry alone.
const preloads = [...html.matchAll(/<link[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/gi)].map((m) => m[1]);
const eagerBytes = preloads.reduce((sum, href) => {
  const file = path.join(distDir, href.replace(/^\//, ""));
  return sum + (existsSync(file) ? statSync(file).size : 0);
}, baseBytes);

const assetsDir = path.join(distDir, "assets");
const assets = existsSync(assetsDir) ? readdirSync(assetsDir) : [];
const missing = EXPECTED_CHUNKS.filter((prefix) => !assets.some((name) => name.startsWith(prefix)));
const assetFiles = EXPECTED_ASSETS.map((asset) => ({
  label: asset.label,
  file: assets.find((name) => asset.pattern.test(name)) ?? null,
}));
// كل JS مُصدَر كنص واحد: غياب اسم الأصل منه يعني أن الصفحة لن تطلبه محليًا.
const emittedJs = assets
  .filter((name) => name.endsWith(".js"))
  .map((name) => readFileSync(path.join(assetsDir, name), "utf8"))
  .join("\n");

const headroom = budget - baseBytes;
console.log("Bundle budget gate");
console.log("  dist      : " + label);
console.log("  entry     : " + entryUrl.replace(/^\//, ""));
console.log("  base      : " + baseBytes + " bytes (budget " + budget + ", headroom " + headroom + ")");
console.log("  eager     : " + eagerBytes + " bytes with " + preloads.length + " modulepreload chunk(s) (informational)");
console.log("  chunks    : " + EXPECTED_CHUNKS.map((p) => p + "* " + (missing.includes(p) ? "MISSING" : "ok")).join(", "));
console.log("  assets    : " + assetFiles.map((a) => a.label + " " + (a.file ? (emittedJs.includes(a.file) ? "ok" : "UNWIRED") : "MISSING")).join(", "));

if (missing.length > 0) {
  fail("expected chunk(s) missing from " + label + "/assets: " + missing.map((p) => p + "*").join(", ") + " - the base entry may have absorbed code that used to be split out");
}
const missingAssets = assetFiles.filter((asset) => asset.file === null);
if (missingAssets.length > 0) {
  fail("expected asset(s) missing from " + label + "/assets: " + missingAssets.map((a) => a.label).join(", ") + " - the code would be fetched from the network again");
}
const unwiredAssets = assetFiles.filter((asset) => asset.file !== null && !emittedJs.includes(asset.file));
if (unwiredAssets.length > 0) {
  fail("asset(s) emitted but referenced by no emitted JS: " + unwiredAssets.map((a) => a.file).join(", ") + " - dead weight that does not prove local loading");
}
if (baseBytes > budget) {
  fail("the base entry is " + baseBytes + " bytes, " + (baseBytes - budget) + " bytes over the " + budget + "-byte budget");
}
console.log("PASS: base entry " + baseBytes + " bytes is within the " + budget + "-byte budget (headroom " + headroom + " bytes).");