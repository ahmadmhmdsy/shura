import { existsSync } from "node:fs";
import { defineConfig, devices, type PlaywrightTestOptions } from "@playwright/test";
import { PREVIEW_ORIGIN, PREVIEW_PORT } from "./e2e/mock-provider";
import { LIVE_SWITCH } from "./e2e/live/liveGate";

// The suite runs against the production build, not the dev server: a gate that only
// passes on unbundled sources is not a release gate.
if (!existsSync("dist/index.html")) {
  throw new Error("dist/index.html is missing. Run pnpm build before pnpm test:e2e.");
}

// The live suite (T6.7) exists only under an explicit switch, so neither CI nor a
// default run can collect it. Traces, screenshots and video are off because the
// suite handles a real credential.
const liveProject =
  process.env[LIVE_SWITCH] === "1"
    ? [
        {
          name: "live",
          use: { trace: "off", screenshot: "off", video: "off", mode: "cdp" } as unknown as PlaywrightTestOptions,
          testMatch: "live/**/*.spec.ts",
        },
      ]
    : [];


export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: PREVIEW_ORIGIN,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "browser",
      use: { ...devices["Desktop Chrome"] },
      // The tauri-*.spec.ts files are the desktop suite: they drive the real
      // WebView2 window over CDP, which a plain browser project cannot do. The
      // tauri project excludes app.spec.ts for the mirror-image reason.
      testIgnore: ["tauri-*.spec.ts", "**/live/**"],
    },
    {
      name: "tauri",
      // "mode" is a tauri-playwright fixture option (documented in its README and
      // consumed at runtime), but the library's types don't model it on the project
      // "use" block, so it's cast through unknown to satisfy tsc without losing the
      // option. This is a known typing gap in @srsholmes/tauri-playwright@0.4.1.
      //
      // "cdp" is the only mode that works on Windows in 0.4.1: the socket branch
      // connects to a Unix socket path (dist/index.js:429) that the Windows plugin
      // never creates, and its tauriCommand branch parses the plugin's TCP port but
      // then discards it, still constructing PluginClient(socketPath) (1703-1708).
      // cdp connects to the running app's DevTools port instead, so it installs no
      // IPC mocks and never defines window.__PW_ACTIVE__ - the spec seeds its own
      // state and waits for the app shell. See e2e/fixtures.ts and tauri-app.spec.ts.
      use: { mode: "cdp" } as unknown as PlaywrightTestOptions,
      // Only the tauri-*.spec.ts files are desktop tests. Without an explicit
      // testMatch the desktop project also collected every browser-mode spec (axe,
      // focus, reflow), running them a second time and burying the real desktop
      // failures under 13 unrelated passes. app.spec.ts is the web-build suite, so
      // the same testMatch excludes it.
      testMatch: "tauri-*.spec.ts",
    },
    ...liveProject,
  ],
  webServer: {
    command: "pnpm exec vite preview --port " + PREVIEW_PORT + " --strictPort --host 127.0.0.1",
    url: PREVIEW_ORIGIN,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
  },
});
