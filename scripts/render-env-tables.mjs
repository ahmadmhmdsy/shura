#!/usr/bin/env node
/**
 * Measured-documentation generator (plan T0.3, decisions D7/Q7).
 *
 * Rewrites the value inside every `<!--G:key-->...<!--/G-->` span in README.md, README.ar.md and
 * docs/environment.md from artifacts the release gate already produced:
 *
 *   dist/index.html + dist/assets/*        -> bundle sizes         (pnpm build)
 *   coverage/coverage-summary.json         -> coverage percentages (pnpm test:coverage)
 *   coverage/vitest-report.json            -> test and file counts (pnpm test:coverage)
 *
 * Markers rather than generated tables: the prose around the numbers is hand-written
 * Arabic documentation and only the measured values move. A value the generator cannot
 * compute is an error (exit 2), never a placeholder, so the documents cannot silently
 * record a guess.
 *
 * Usage:
 *   node scripts/render-env-tables.mjs           rewrite the documents
 *   node scripts/render-env-tables.mjs --check   compare only, non-zero when they drift
 *
 * Exit codes: 0 = documents match the artifacts, 1 = drift (--check), 2 = cannot measure.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import process from "node:process";

const BUDGET_BYTES = 1_200_000;
// Byte sizes are divided by 1000 to match how the bundler prints them; gzip is measured
// here with Node zlib level 9. Vite prints its own gzip figure from the bundler, which
// can differ by about one percent, so the documents say which convention they record.
const REPO = path.resolve(import.meta.dirname, "..");
const DOCUMENTS = ["README.md", "README.ar.md", "docs/environment.md"];
const MARKER = /<!--G:([A-Za-z0-9._-]+)-->[\s\S]*?<!--\/G-->/g;

function cannotMeasure(reason) {
  console.error("SKIPPED: " + reason);
  process.exit(2);
}

function fail(reason) {
  console.error("FAIL: " + reason);
  process.exit(1);
}

const decimal = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kB = (bytes) => decimal.format(bytes / 1000);

const distDir = path.join(REPO, "dist");
const assetsDir = path.join(distDir, "assets");
const indexPath = path.join(distDir, "index.html");
if (!existsSync(assetsDir)) cannotMeasure("dist/assets is missing - run pnpm build first");
if (!existsSync(indexPath)) cannotMeasure("dist/index.html is missing - run pnpm build first");

const assets = readdirSync(assetsDir);
const covered = new Set();
function assetFile(prefix, suffix, label) {
  const name = assets.find((n) => n.startsWith(prefix) && n.endsWith(suffix));
  if (!name) cannotMeasure("dist/assets has no " + label + " chunk (" + prefix + "*" + suffix + ") - run pnpm build");
  covered.add(name);
  return path.join(assetsDir, name);
}

function measure(file) {
  const bytes = statSync(file).size;
  return { bytes: bytes, gzip: gzipSync(readFileSync(file), { level: 9 }).length };
}

const indexHtml = readFileSync(indexPath);
const entryUrl = (/<script[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/i.exec(indexHtml) || [])[1];
if (!entryUrl) cannotMeasure("dist/index.html references no module script entry");

const values = new Map();
function addBundle(key, file) {
  const m = measure(file);
  values.set("bundle." + key + ".kb", kB(m.bytes));
  values.set("bundle." + key + ".gzip", kB(m.gzip));
  return m;
}

const entryFile = path.join(distDir, entryUrl.replace(/^\//, ""));
if (!existsSync(entryFile)) cannotMeasure("the entry referenced by index.html is missing: " + entryUrl);
covered.add(path.basename(entryFile));
const entry = addBundle("entry", entryFile);
addBundle("pdf", assetFile("pdf-", ".js", "pdf.js"));
addBundle("ort", assetFile("ort.wasm.bundle.min-", ".js", "onnxruntime"));
addBundle("ragTool", assetFile("rag-tool-", ".js", "rag-tool"));
addBundle("ragEmbedder", assetFile("rag-embedder-", ".js", "rag-embedder"));
// مُرمِّز التضمين حزمة كسولة منفصلة (ADR 0003): قياسها المنفصل هو ما يجعل أي عودة إلى
// مكتبة ترميز أثقل (26.9 م.ب من wasm مثلًا) مرئية في الجدول لا مخفية داخل الحمولة.
addBundle("tokenizers", assetFile("tokenizers-", ".js", "tokenizers"));
// الأصول المنفَّذة التي حزّمها T1.3 (ADR 0004): قياسها المنفصل يجعل أي عودة إلى CDN أو إلى
// نسخة jsep الأثقل (28.3 م.ب) مرئية في الجدول لا مخفية داخل الحمولة.
addBundle("ortWasm", assetFile("ort-wasm-simd-threaded-", ".wasm", "ort wasm"));
addBundle("ortGlue", assetFile("ort-wasm-simd-threaded-", ".mjs", "ort glue"));
addBundle("pdfWorker", assetFile("pdf.worker.min-", ".mjs", "pdf worker"));
// قطع الحمولة الفعلية المتبقية (LV-09): جزء من قائمة modulepreload عند الإقلاع.
addBundle("ragVectorIndex", assetFile("rag-vector-index-", ".js", "rag-vector-index"));
addBundle("hnswlib", assetFile("hnswlib-wasm-", ".js", "hnswlib-wasm"));
addBundle("css", assetFile("index-", ".css", "stylesheet"));
addBundle("credentialStore", assetFile("credentialStore-", ".js", "credential-store"));
addBundle("distJs", assetFile("dist-js-", ".js", "dist-js"));
addBundle("html", indexPath);

// The eager payload is what the browser actually fetches at startup: the base entry plus
// every chunk index.html modulepreloads. D7 gates the base entry (Q7); this number is
// reported so the gap stays visible (LV-09).
const preloads = [...indexHtml.toString("utf8").matchAll(/<link[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/gi)].map((m) => m[1]);
const eagerBytes = preloads.reduce((sum, href) => {
  const file = path.join(distDir, href.replace(/^\//, ""));
  return sum + (existsSync(file) ? statSync(file).size : 0);
}, entry.bytes);
values.set("bundle.eager.kb", kB(eagerBytes));

const headroom = BUDGET_BYTES - entry.bytes;
values.set("bundle.headroom.kb", kB(headroom));
values.set("bundle.headroom.percent", ((headroom / BUDGET_BYTES) * 100).toFixed(1));

const summaryPath = path.join(REPO, "coverage", "coverage-summary.json");
if (!existsSync(summaryPath)) cannotMeasure("coverage/coverage-summary.json is missing - run pnpm test:coverage first");
let summary;
try { summary = JSON.parse(readFileSync(summaryPath, "utf8")); }
catch (error) { cannotMeasure("coverage/coverage-summary.json is not valid JSON: " + error.message); }
const total = summary && summary.total;
if (!total) cannotMeasure("coverage/coverage-summary.json has no total entry");
for (const pair of [["cov.statements", "statements"], ["cov.branches", "branches"], ["cov.functions", "functions"], ["cov.lines", "lines"]]) {
  const metric = total[pair[1]];
  if (!metric || typeof metric.pct !== "number") cannotMeasure("the coverage summary has no " + pair[1] + " percentage");
  values.set(pair[0], decimal.format(metric.pct));
}

const reportPath = path.join(REPO, "coverage", "vitest-report.json");
if (!existsSync(reportPath)) cannotMeasure("coverage/vitest-report.json is missing - run pnpm test:coverage first");
let report;
try { report = JSON.parse(readFileSync(reportPath, "utf8")); }
catch (error) { cannotMeasure("coverage/vitest-report.json is not valid JSON: " + error.message); }
if (!Array.isArray(report.testResults) || !report.testResults.length || typeof report.numTotalTests !== "number") {
  cannotMeasure("coverage/vitest-report.json does not look like a Vitest JSON report");
}
if (typeof report.numPassedTests !== "number") cannotMeasure("the Vitest report has no numPassedTests");
values.set("counts.files", String(report.testResults.length));
values.set("counts.tests", String(report.numTotalTests));
values.set("counts.testsPassed", String(report.numPassedTests));

const checkOnly = process.argv.includes("--check");
const used = new Set();
const drifted = [];
let written = 0;

for (const relative of DOCUMENTS) {
  const file = path.join(REPO, relative);
  if (!existsSync(file)) cannotMeasure(relative + " is missing");
  const before = readFileSync(file, "utf8");
  const opens = (before.match(/<!--G:/g) || []).length;
  const closes = (before.match(/<!--\/G-->/g) || []).length;
  if (opens !== closes) cannotMeasure(relative + " has " + opens + " opening and " + closes + " closing G markers");
  const unknown = [];
  const after = before.replace(MARKER, (match, key) => {
    used.add(key);
    if (!values.has(key)) { unknown.push(key); return match; }
    return "<!--G:" + key + "-->" + values.get(key) + "<!--/G-->";
  });
  if (unknown.length) cannotMeasure(relative + " uses marker key(s) this generator cannot compute: " + unknown.join(", "));
  if (after === before) continue;
  if (checkOnly) { drifted.push(relative); continue; }
  writeFileSync(file, after);
  written++;
  console.log("updated " + relative);
}

console.log("Measured documentation values");
for (const key of ["counts.files", "counts.tests", "counts.testsPassed", "cov.statements", "cov.branches", "cov.functions", "cov.lines", "bundle.entry.kb", "bundle.headroom.kb", "bundle.eager.kb"]) {
  console.log("  " + key.padEnd(22) + " " + values.get(key));
}

const unusedKeys = [...values.keys()].filter((k) => !used.has(k));
if (unusedKeys.length) console.log("NOTE: computed but unused in the documents: " + unusedKeys.join(", "));
const undocumented = assets.filter((n) => !covered.has(n) && /\.(js|css)$/.test(n));
if (undocumented.length) console.log("NOTE: dist/assets holds " + undocumented.length + " file(s) with no documented row: " + undocumented.join(", "));

if (checkOnly && drifted.length) {
  for (const relative of drifted) console.error("FAIL: " + relative + " does not match the measured artifacts - run pnpm docs:numbers");
  process.exit(1);
}
console.log(checkOnly ? "PASS: the documents match the measured artifacts." : "PASS: updated " + written + " document(s).");