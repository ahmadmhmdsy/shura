#!/usr/bin/env node
/**
 * Runs the desktop Playwright suite against a real Tauri (WebView2) window.
 *
 * Why this exists: @srsholmes/tauri-playwright@0.4.1 cannot drive a Windows
 * desktop app in its "tauri" mode. That branch connects to a Unix socket path
 * (dist/index.js:429) which the Windows plugin never creates, and its
 * tauriCommand branch parses the plugin's TCP port and then discards it, still
 * building PluginClient(socketPath) (dist/index.js:1703-1708).
 *
 * "cdp" mode does work: Playwright attaches to the app's DevTools port. That
 * needs the app already running with that port open, so this script owns the
 * app lifecycle - start it, wait for the endpoint, run the suite, stop it.
 *
 * Usage:
 *   pnpm test:e2e:desktop
 *   TAURI_E2E_APP=<path-to-app.exe> TAURI_E2E_CDP=http://127.0.0.1:9333 pnpm test:e2e:desktop
 *   pnpm test:e2e:desktop --grep "settings dialog"
 *
 * Environment:
 *   TAURI_E2E_APP  binary to launch; defaults to the most recently built one.
 *   TAURI_E2E_CDP  DevTools endpoint whose port the app is told to open.
 *   TAURI_E2E_PROJECT  Playwright project to run; defaults to tauri. The live
 *                  suite sets it to live.
 */
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

const project = process.env.TAURI_E2E_PROJECT ?? "tauri";
if (project !== "tauri" && project !== "live") {
  console.error("[e2e-desktop] TAURI_E2E_PROJECT must be tauri or live, got " + project);
  process.exit(1);
}

const endpoint = process.env.TAURI_E2E_CDP ?? "http://127.0.0.1:9222";
const port = Number(new URL(endpoint).port || 9222);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`[e2e-desktop] TAURI_E2E_CDP must carry a valid port, got ${endpoint}`);
  process.exit(1);
}

const binaryName = process.platform === "win32" ? "app.exe" : "app";
// Prefer the most recently built binary: the desktop specs resolve the wasm and
// chunk names from dist/assets and request those exact hashed URLs from the
// running app, so a binary whose embedded frontend predates the last build would
// 404. TAURI_E2E_APP picks one outright when the guess is wrong.
const candidates = [
  join("src-tauri", "target", "release", binaryName),
  join("src-tauri", "target", "debug", binaryName),
].filter((candidate) => existsSync(candidate));
const appPath =
  process.env.TAURI_E2E_APP ?? candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
if (!appPath) {
  console.error("[e2e-desktop] no desktop binary found - build one first: pnpm tauri build --debug --no-bundle");
  process.exit(1);
}

const cli = ["node_modules/@playwright/test/cli.js", "node_modules/playwright/cli.js"].find((candidate) => existsSync(candidate));
if (!cli) {
  console.error("[e2e-desktop] Playwright CLI not found - run pnpm install");
  process.exit(1);
}

const app = spawn(appPath, [], {
  stdio: "ignore",
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
});

let stopping = false;
const stopApp = () => {
  if (stopping) return;
  stopping = true;
  app.kill();
};
process.on("exit", stopApp);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopApp();
    process.exit(130);
  });
}

const waitForEndpoint = async (timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (app.exitCode !== null) throw new Error(`the app exited (code ${app.exitCode}) before its DevTools endpoint opened`);
    try {
      if ((await fetch(`${endpoint}/json/version`)).ok) return;
    } catch {
      // Not listening yet; keep polling until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`no DevTools endpoint at ${endpoint} within ${timeoutMs}ms`);
};

try {
  await waitForEndpoint();
  console.log(`[e2e-desktop] ${appPath} is serving CDP on ${endpoint}`);
  process.exitCode = await new Promise((resolve) => {
    const runner = spawn(process.execPath, [cli, "test", "--project=" + project, ...process.argv.slice(2)], { stdio: "inherit" });
    runner.on("exit", (code) => resolve(code ?? 1));
  });
} catch (error) {
  console.error(`[e2e-desktop] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  stopApp();
}
