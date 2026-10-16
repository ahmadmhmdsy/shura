import { createTauriTest } from '@srsholmes/tauri-playwright';
import { PREVIEW_ORIGIN } from './mock-provider';

export const { test, expect } = createTauriTest({
  // The preview origin. "browser" and "tauri" modes navigate to it; "cdp" ignores
  // it, so tauri-app.spec.ts navigates the app window there itself.
  devUrl: PREVIEW_ORIGIN,

  // Windows desktop mode. The app must already be running with its DevTools port
  // open: set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
  // before launching it. The default matches that port.
  cdpEndpoint: process.env.TAURI_E2E_CDP ?? 'http://127.0.0.1:9222',

  // Mock Tauri IPC commands that the app uses. These apply in "browser" mode
  // only - "cdp" mode drives the real WebView2, so the commands reach the real
  // backend (the desktop tests only read from it). The library types every mock
  // as (args?: Record<string, unknown>) => unknown, so each handler is declared
  // with an optional args parameter it simply ignores.
  ipcMocks: {
    // Credential backend commands
    'get_provider_key': (_args?: Record<string, unknown>) => null,
    'set_provider_key': (_args?: Record<string, unknown>) => undefined,
    'delete_provider_key': (_args?: Record<string, unknown>) => undefined,
  },

  // Path to the socket for Tauri mode
  mcpSocket: process.env.TAURI_PLAYWRIGHT_SOCKET || '/tmp/tauri-playwright.sock',
});
