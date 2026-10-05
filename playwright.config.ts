import { existsSync } from "node:fs";
import { defineConfig, devices, type PlaywrightTestOptions } from "@playwright/test";
import { PREVIEW_ORIGIN, PREVIEW_PORT } from "./e2e/mock-provider";

// The suite runs against the production build, not the dev server: a gate that only
// passes on unbundled sources is not a release gate.
if (!existsSync("dist/index.html")) {
  throw new Error("dist/index.html is missing. Run pnpm build before pnpm test:e2e.");
}

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
    },
    {
      name: "tauri",
      // "mode" is a tauri-playwright fixture option (documented in its README and
      // consumed at runtime), but the library's types don't model it on the project
      // "use" block, so it's cast through unknown to satisfy tsc without losing the
      // option. This is a known typing gap in @srsholmes/tauri-playwright@0.4.1.
      use: { mode: "tauri" } as unknown as PlaywrightTestOptions,
      // app.spec.ts is the web-build (browser) suite: it drives the raw
      // Playwright page fixture with IPC mocks and cannot run against the
      // Tauri webview. Only tauri-app.spec.ts exercises the desktop app.
      testIgnore: "app.spec.ts",
    },
  ],
  webServer: {
    command: "pnpm exec vite preview --port " + PREVIEW_PORT + " --strictPort --host 127.0.0.1",
    url: PREVIEW_ORIGIN,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
  },
});
