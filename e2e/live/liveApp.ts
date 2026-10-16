/*
 * [T6.7] The live seam and the helpers the live specs drive.
 *
 * The live suite runs in the real WebView2 window on the app's OWN origin
 * (http://tauri.localhost), because that is where the production CSP, the
 * packaged bundle and the OS-keychain credential store are all active - the
 * three things a live result is meant to vouch for.
 *
 * seedProviderKey writes through the app's own Settings dialog, so the value
 * travels the same path a user's key travels: form state -> credential store ->
 * Tauri command -> OS keychain. The live project runs with traces, screenshots
 * and video off (playwright.config.ts), so nothing captures the value into
 * test-results/ or playwright-report/; scripts/live-secret-scan.mjs is the
 * check that this holds.
 */
import { expect, type Page } from "@playwright/test";
import { resultCards } from "../app-helpers";

/** The Tauri custom protocol origin on Windows; TAURI_E2E_URL overrides it. */
export const LIVE_APP_URL = process.env.TAURI_E2E_URL ?? "http://tauri.localhost/";

/**
 * cdp mode drives the app through the library's BrowserPageAdapter; its
 * underlying Playwright page is what exposes fill/expect. The fixture type is a
 * union with the socket-mode TauriPage, so narrow it once here (the same
 * narrowing tauri-csp.spec.ts does for its own needs).
 */
export function playwrightPageOf(tauriPage: unknown): Page {
  return (tauriPage as { playwrightPage: Page }).playwrightPage;
}

/** Boot the app with the first-run dialog dismissed. */
export async function openApp(page: Page): Promise<void> {
  await page.goto(LIVE_APP_URL);
  // The onboarding dialog is modal and aria-hides the app behind it, so the flag
  // must be set before the app mounts. It persists in the app profile.
  await page.evaluate(() => localStorage.setItem("shura-onboarding-seen", "true"));
  await page.reload();
  await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
}

/**
 * Save a provider key through the app's own path. The key is never logged, never
 * put in a test title, and never passed to addInitScript.
 */
export async function seedProviderKey(page: Page, providerId: string, key: string): Promise<void> {
  await page.getByRole("button", { name: "الإعدادات" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const field = page.locator("#provider-key-" + providerId);
  await field.fill(key);
  // The write happens on blur, and the card test button enables only from the
  // saved key, so waiting for it proves the credential store accepted the value.
  // Scope it to the field own card: every provider card is rendered inside one
  // and the same #section-providers, so .first() would be another provider.
  const card = field.locator("xpath=..");
  await field.press("Tab");
  await expect(card.getByRole("button", { name: "اختبار" })).toBeEnabled({ timeout: 30_000 });
  await dialog.getByRole("button", { name: "تم" }).click();
  await expect(dialog).toBeHidden();
}

/** Attach one model to the current session through the add-model dialog. */
export async function addModel(page: Page, providerLabel: string, modelLabel: string): Promise<void> {
  await page.getByRole("button", { name: "إضافة نموذج" }).click();
  const dialog = page.getByRole("dialog");
  // The provider button appends a desktop-required badge to its accessible name,
  // so the match must stay a substring (see tauri-app.spec.ts).
  await dialog.getByRole("button", { name: providerLabel }).first().click();
  await dialog.getByRole("button", { name: modelLabel }).first().click();
  await expect(dialog).toBeHidden();
}

export interface LiveTurn {
  /** The answer body only: the usage footer is a sibling of the status region. */
  answer: string;
  usageVisible: boolean;
}

/** Wait for the turn to end, then read the answer body and the usage footer. */
export async function awaitTurn(page: Page, timeoutMs = 120_000): Promise<LiveTurn> {
  // The operation is over when the composer offers send again - the same rule
  // the browser suite encodes in awaitTurnComplete.
  await expect(page.getByRole("button", { name: "إرسال" })).toBeVisible({ timeout: timeoutMs });
  const card = resultCards(page).first();
  await expect(card).toBeVisible();
  const answer = (await card.innerText()).trim();
  const usageVisible = (await page.getByText(/↓\s*\d+/).count()) > 0;
  return { answer, usageVisible };
}
