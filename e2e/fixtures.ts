import { createTauriTest } from '@srsholmes/tauri-playwright';
import { PREVIEW_ORIGIN } from './mock-provider';

export const { test, expect } = createTauriTest({
  // Use the same origin as the Playwright config baseURL
  devUrl: PREVIEW_ORIGIN,

  // Mock Tauri IPC commands that the app uses. The library types every mock as
  // (args?: Record<string, unknown>) => unknown, so each handler is declared with
  // an optional args parameter it simply ignores.
  ipcMocks: {
    // Credential backend commands
    'get_provider_key': (_args?: Record<string, unknown>) => null,
    'set_provider_key': (_args?: Record<string, unknown>) => undefined,
    'delete_provider_key': (_args?: Record<string, unknown>) => undefined,
  },

  // Path to the socket for Tauri mode
  mcpSocket: process.env.TAURI_PLAYWRIGHT_SOCKET || '/tmp/tauri-playwright.sock',
});
