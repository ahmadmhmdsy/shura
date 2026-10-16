/*
 * [T5.1] Helpers shared by the browser suites: a minimal boot, the settings/session/model
 * setup every scenario needs, and the DOM accessors that keep selectors in one place.
 */
import { expect, type Page } from "@playwright/test";
import { installMockProvider, type MockRequestRecord } from "./mock-provider";

// Not a credential: the mock provider never leaves the page, and the app only needs a
// non-empty string to build a request.
export const FAKE_KEY = "e2e-fake-key";
export const SHARED_PLACEHOLDER = "اكتب سؤالك الموحد للجميع…";
export const CUSTOM_PLACEHOLDER = "سؤال مخصص لهذا النموذج (فارغ = يرث السؤال الموحد)";
export const REPLY = "رد محلي ثابت";
export const GPT4O = "openai/gpt-4o";

// The live OpenRouter model catalog is a GET; only POSTs are provider calls.
export function posts(records: MockRequestRecord[]): MockRequestRecord[] {
  return records.filter((record) => record.method === "POST");
}

// The operation is over only when the composer offers "send" again and the card carries
// its usage footer: text is painted while a row is still streaming, and a streaming row is
// deliberately not part of the session history.
export async function awaitTurnComplete(page: Page, expectedCards: number): Promise<void> {
  await expect(page.getByRole("button", { name: "إرسال" })).toBeVisible();
  await expect(page.getByText("↓ 12")).toHaveCount(expectedCards);
}

export function texts(record: MockRequestRecord): string[] {
  const body = record.body as { messages?: { role: string; content: unknown }[] } | null;
  if (!body || !Array.isArray(body.messages)) return [];
  return body.messages.map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)));
}

export async function boot(page: Page, options: { theme?: "light" | "dark" } = {}): Promise<void> {
  // نافذة البداية الأولى مودالية وتُخفي التطبيق خلفها، فلا يصل الاختبار إلى ترويسة
  // الشريط الجانبي ما لم تُضبط الراية قبل تشغيل أي كود تطبيق. نفس أسلوب tauri-app.spec.ts.
  // [T5.1] The theme is a stored preference, so a state can be measured in both palettes.
  await page.addInitScript((theme) => {
    localStorage.setItem("shura-onboarding-seen", "true");
    if (theme) localStorage.setItem("shura-theme", theme);
  }, options.theme ?? null);
  await installMockProvider(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "شورى" })).toBeVisible();
}

export async function saveFakeKey(page: Page): Promise<void> {
  await page.getByRole("button", { name: "الإعدادات" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const field = page.locator("#provider-key-openrouter");
  await field.fill(FAKE_KEY);
  await field.press("Tab");
  // The test button enables only from the saved key, not from the unsaved draft.
  await expect(dialog.getByRole("button", { name: "اختبار" }).first()).toBeEnabled();
  await dialog.getByRole("button", { name: "تم" }).click();
  await expect(dialog).toBeHidden();
}

export async function openNewSession(page: Page): Promise<void> {
  await page.getByRole("button", { name: "جلسة جديدة", exact: true }).first().click();
  await expect(page.getByPlaceholder(SHARED_PLACEHOLDER)).toBeVisible();
}

export async function addOpenRouterGpt4o(page: Page): Promise<void> {
  await page.getByRole("button", { name: "إضافة نموذج" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "OpenRouter", exact: true }).click();
  await dialog.getByRole("button", { name: new RegExp(GPT4O) }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("OpenRouter · " + GPT4O)).toBeVisible();
}

export async function send(page: Page, prompt: string): Promise<void> {
  await page.getByPlaceholder(SHARED_PLACEHOLDER).fill(prompt);
  await page.getByRole("button", { name: "إرسال" }).click();
}

// A session row is the title button. The rename and delete controls that share the row
// carry their own aria-labels and must never be mistaken for the opener. Scoping to the
// row also keeps the empty-state "create session" button — likewise unlabelled — out of
// the set once the last session is deleted.
export function sessionRows(page: Page) {
  return page.getByTestId("session-row").locator("button:not([aria-label])");
}

// The polite live-region announcer is sr-only; a result card body is the visible status
// region that actually holds the answer text.
export function resultCards(page: Page) {
  return page.locator('[role="status"][aria-busy]');
}
