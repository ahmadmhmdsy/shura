/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// __dirname is not defined in an ESM config (the file was previously type-checked as CJS
// and failed the gate with TS2688-class errors); import.meta.url is the real ESM source of
// truth, so the alias resolves identically under Vite, Vitest, and tsc.
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Mock WASM modules in test environment
      "hnswlib-wasm": fileURLToPath(new URL("./src/test/mocks/hnswlib-wasm.ts", import.meta.url)),
    },
  },
  // Advisory only: Vite's warning is not a gate. The release budget is enforced in bytes by
  // scripts/check-bundle.mjs (1,200,000 bytes on the base entry) and runs inside pnpm check:all.
  // Keep this limit in step with that constant so the warning keeps meaning something.
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Split the RAG pipeline modules into separate chunks so each is cached
        // independently and loaded only when the RAG feature is used.
        // Vite 8 bundles with Rolldown: the manualChunks object form is unsupported
        // and its function form applies a default minSize that would merge the
        // small vectorIndex module into rag-tool, so codeSplitting groups with
        // minSize: 0 keep all three modules in their own chunks.
        codeSplitting: {
          minSize: 0,
          groups: [
            { name: "rag-embedder", test: /src[\\/]lib[\\/]rag[\\/]embedder\.ts$/ },
            { name: "rag-vector-index", test: /src[\\/]lib[\\/]rag[\\/]vectorIndex\.ts$/ },
            { name: "rag-tool", test: /src[\\/]lib[\\/]rag[\\/]tool\.ts$/ },
          ],
        },
      },
    },
  },
  // Tooling that writes through a sibling temp directory (for example a test runner staging
  // a spec as e2e/.app.spec.ts.<pid>.<uuid>.tmpdir/app.spec.ts.tmp) makes chokidar watch a file
  // that is replaced mid-read; on Windows that aborts the dev server with EBUSY. The cargo
  // build under src-tauri/target has the same effect while tauri dev runs both side by side.
  server: {
    // Bind IPv4 explicitly: the Tauri webview and the e2e bridge both dial
    // 127.0.0.1, and an IPv6-only (::1) bind is unreachable from the webview.
    host: "127.0.0.1",
    // Fixed port so tauri.conf.json devUrl can point at it deterministically
    // (5173 is occupied by another project on this machine).
    port: 5174,
    watch: { ignored: ["**/.*.tmpdir/**", "**/src-tauri/target/**"] },
    proxy: {
      // tauri-plugin-playwright's injected bridge polls these relative URLs
      // from the webview; forward them to the plugin's HTTP callback server.
      "/pw-poll": "http://127.0.0.1:6275",
      "/pw": "http://127.0.0.1:6275",
    },
  },
  preview: {
    proxy: {
      // Same bridge proxy for the preview server the e2e suite runs against.
      "/pw-poll": "http://127.0.0.1:6275",
      "/pw": "http://127.0.0.1:6275",
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
    // The machine-readable twin of the console report: scripts/render-env-tables.mjs
    // measures the documented test/file counts from it.
    reporters: ["default", ["json", { outputFile: "coverage/vitest-report.json" }]],
    // The browser suite in e2e/ is Playwright's: collecting it here would register
    // Playwright's test() inside Vitest and abort the whole run.
    exclude: ["**/node_modules/**", "**/dist/**", "**/src-tauri/**", "e2e/**"],
    coverage: {
      provider: "v8",
      // "json-summary" is what scripts/render-env-tables.mjs (pnpm docs:numbers) reads
      // its documented percentages from; "text" stays for humans and "lcov" for tooling.
      reporter: ["text", "lcov", "json-summary"],
      // Only application code is measured. Test helpers, the test setup, and the
      // Playwright suite are infrastructure, not product surface.
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/test/**", "**/*.spec.{ts,tsx}", "src/vite-env.d.ts", "src/spec-node-types.d.ts"],
      thresholds: { statements: 80, branches: 75, functions: 80, lines: 80 },
    },
  },
});
