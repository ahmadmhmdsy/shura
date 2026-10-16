import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Page, Request, Response } from "@playwright/test";
import { expect, test } from "./fixtures";

/*
 * [T6.2] Desktop smoke for the CSP/wasm path (the fix for NH-02, decision D4).
 *
 * Why this file exists: the production CSP in src-tauri/tauri.conf.json used to
 * kill the whole local RAG runtime - script-src never allowed WebAssembly, and
 * the ONNX Runtime wasm was fetched from a CDN. No browser-mode test can see
 * that: the browser project serves the same bundle over plain HTTP with no CSP
 * at all, and no spec drives the embedding path. This spec runs against the
 * app's OWN origin (http://tauri.localhost), where the production CSP is the one
 * actually enforced.
 *
 * What it does not do: download an embedding model (130 MB for the default
 * "multilingual-e5-small") or run an inference. That needs the network and the
 * Rust-side HTTP plugin, so it belongs in an opt-in live suite rather than in
 * the gate. Here the runtime itself is the subject: wasm compilation, the
 * bundled ORT assets, and ORT getting far enough to reject deliberately invalid
 * model bytes - none of which can happen while script-src blocks wasm.
 *
 * The suite is driven by scripts/e2e-desktop.mjs (pnpm test:e2e:desktop), which
 * owns the app lifecycle and its DevTools port.
 */

// The Tauri custom protocol origin on Windows. tauri-app.spec.ts deliberately
// navigates the window to the vite preview origin instead, so that its writes
// stay out of the app's own profile; this spec navigates back, because the
// production CSP only exists here.
const APP_ORIGIN = "http://tauri.localhost";

const ASSETS_DIR = join(process.cwd(), "dist", "assets");

/** Resolve a hashed build output name; hardcoding one would break on the next build. */
function bundledAsset(pattern: RegExp): string {
  const name = readdirSync(ASSETS_DIR).find((file) => pattern.test(file));
  if (!name) throw new Error(`no dist/assets file matches ${pattern} - run pnpm build`);
  return name;
}

const ORT_CHUNK = bundledAsset(/^ort\.wasm\.bundle\.min-.*\.js$/);
const ORT_WASM = bundledAsset(/^ort-wasm-simd-threaded-.*\.wasm$/);
const ORT_WASM_MJS = bundledAsset(/^ort-wasm-simd-threaded-.*\.mjs$/);

/** (func (export "add") (param i32 i32) (result i32)) - the smallest useful module. */
const TINY_WASM_BASE64 = "AGFzbQEAAAABBwFgAn9/AX8DAgEABwcBA2FkZAAACgkBBwAgACABags=";

interface OrtModule {
  env: { wasm: { wasmPaths: { wasm: string; mjs: string } } };
  InferenceSession: { create(bytes: Uint8Array): Promise<unknown> };
}

type CspWindow = Window & { __cspViolations?: string[] };

// Explicit parameter types: page.evaluate's generic overload infers them only
// unreliably, and an implicit any fails pnpm build (which compiles e2e/).
interface WasmProbeArgs {
  origin: string;
  wasm: string;
  tiny: string;
}

interface OrtProbeArgs {
  origin: string;
  chunk: string;
  wasm: string;
  mjs: string;
}

/**
 * cdp mode drives the app through the library's BrowserPageAdapter, whose
 * underlying Playwright page is what exposes network events and the typed
 * evaluate these tests need. The fixture's type is a union with the socket-mode
 * TauriPage, so narrow it here rather than at every call site.
 */
function playwrightPageOf(tauriPage: unknown): Page {
  return (tauriPage as { playwrightPage: Page }).playwrightPage;
}

test.beforeEach(async ({ tauriPage }) => {
  await tauriPage.goto(`${APP_ORIGIN}/`);
  await tauriPage.waitForFunction('document.readyState === "complete"');
});

test("WebAssembly is permitted and the bundled ONNX Runtime wasm compiles in the app's own origin", async ({ tauriPage }) => {
  const page = playwrightPageOf(tauriPage);
  // The production CSP is the subject, so a violation that still lets the call
  // through is a failure too.
  await page.evaluate(() => {
    const target = window as CspWindow;
    target.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      target.__cspViolations?.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });

  const measured = await page.evaluate(
    async ({ origin, wasm, tiny }: WasmProbeArgs) => {
      const module = Uint8Array.from(atob(tiny), (char) => char.charCodeAt(0));
      const instance = await WebAssembly.instantiate(module, {});
      const add = (instance.instance.exports as unknown as { add(a: number, b: number): number }).add;
      const response = await fetch(`${origin}/assets/${wasm}`);
      const wasmBytes = await response.arrayBuffer();
      const compiled = await WebAssembly.compile(wasmBytes);
      const target = window as CspWindow;
      return {
        origin: window.location.origin,
        sum: add(2, 3),
        status: response.status,
        bytes: wasmBytes.byteLength,
        compiled: compiled instanceof WebAssembly.Module,
        violations: target.__cspViolations ?? [],
      };
    },
    { origin: APP_ORIGIN, wasm: ORT_WASM, tiny: TINY_WASM_BASE64 },
  );

  expect(measured.origin).toBe(APP_ORIGIN);
  expect(measured.sum, "wasm runs under the production CSP").toBe(5);
  expect(measured.status, `${ORT_WASM} is served from the app origin`).toBe(200);
  // 13.6 MB is the wasm-only ONNX Runtime build the app ships (D1: no JSEP build).
  expect(measured.bytes).toBeGreaterThan(10_000_000);
  expect(measured.compiled, "the bundled ORT wasm compiles").toBe(true);
  expect(measured.violations, "securitypolicyviolation events").toEqual([]);
});

test("ONNX Runtime initialises from the app's own origin and reaches model creation", async ({ tauriPage }) => {
  const page = playwrightPageOf(tauriPage);
  const wasmStatuses: number[] = [];
  const cdnRequests: string[] = [];
  page.on("response", (response: Response) => {
    if (response.url().includes(ORT_WASM)) wasmStatuses.push(response.status());
  });
  page.on("request", (request: Request) => {
    if (/cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com/.test(request.url())) cdnRequests.push(request.url());
  });

  const measured = await page.evaluate(
    async ({ origin, chunk, wasm, mjs }: OrtProbeArgs) => {
      const ort = (await import(`${origin}/assets/${chunk}`)) as OrtModule;
      ort.env.wasm.wasmPaths = { wasm: `${origin}/assets/${wasm}`, mjs: `${origin}/assets/${mjs}` };
      let error: string;
      try {
        // Four bytes are not an ONNX model. What matters is what happens first:
        // the runtime must load its own wasm from the app origin and get far
        // enough to try, rather than reporting that no backend is available.
        await ort.InferenceSession.create(new Uint8Array([8, 7, 6, 5]));
        error = "resolved";
      } catch (cause) {
        error = String(cause);
      }
      return { api: typeof ort.InferenceSession, env: typeof ort.env, error };
    },
    { origin: APP_ORIGIN, chunk: ORT_CHUNK, wasm: ORT_WASM, mjs: ORT_WASM_MJS },
  );

  expect(measured.api).toBe("function");
  expect(measured.env).toBe("object");
  expect(wasmStatuses, "the runtime fetched its own bundled wasm").toContain(200);
  expect(measured.error, "invalid bytes are rejected after the runtime loads").not.toBe("resolved");
  // Without 'wasm-unsafe-eval' ORT reports "no available backend found ... [wasm]
  // ... unsafe-eval", and a blocked asset fetch reports a network error. Neither
  // is a model-parse failure, so either one means the runtime never started.
  expect(measured.error).not.toMatch(/no available backend|unsafe-eval|Content Security Policy|Refused to compile/i);
  expect(cdnRequests, "requests to a CDN host").toEqual([]);
});
