# Tauri E2E Testing

This project supports two modes of E2E testing:

## Option A: Browser Mode (Web Build)

Tests run against the production web build using headless Chromium.
Tauri IPC calls are mocked.

```bash
# Build the app first
pnpm build

# Run tests in browser mode
pnpm test:e2e:browser
```

## Option B: Tauri Mode (Desktop App)

Tests run against the real Tauri desktop app webview.
Requires the `e2e-testing` feature to be enabled.

```bash
# Terminal 1: Start the Tauri dev server with e2e-testing enabled
pnpm tauri:dev:e2e

# Terminal 2: Run tests in Tauri mode
pnpm test:e2e:tauri
```

## Files

- `e2e/fixtures.ts` - Test fixtures with Tauri IPC mocks
- `e2e/tauri-app.spec.ts` - Tauri E2E tests
- `e2e/app.spec.ts` - Web build E2E tests (existing)
- `e2e/mock-provider.ts` - Mock provider for web build tests
- `playwright.config.ts` - Playwright configuration

## How It Works

### Browser Mode
- Uses headless Chromium
- Tauri IPC calls are mocked in `fixtures.ts`
- Fast and CI-friendly

### Tauri Mode
- Connects to the real Tauri webview via a socket bridge
- Tests the actual Tauri APIs (fs, dialog, http plugins)
- Requires `tauri-plugin-playwright` (Rust) and `@srsholmes/tauri-playwright` (npm)
