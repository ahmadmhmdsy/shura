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
  // 1200 kB is the release budget recorded in docs/environment.md; a chunk above it
  // needs a documented code split before release.
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
  // that is replaced mid-read; on Windows that aborts the dev server with EBUSY.
  server: { watch: { ignored: ["**/.*.tmpdir/**"] } },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
    // The browser suite in e2e/ is Playwright's: collecting it here would register
    // Playwright's test() inside Vitest and abort the whole run.
    exclude: ["**/node_modules/**", "**/dist/**", "**/src-tauri/**", "e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      // Only application code is measured. Test helpers, the test setup, and the
      // Playwright suite are infrastructure, not product surface.
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/test/**", "**/*.spec.{ts,tsx}", "src/vite-env.d.ts", "src/spec-node-types.d.ts"],
      thresholds: { statements: 80, branches: 75, functions: 80, lines: 80 },
    },
  },
});
