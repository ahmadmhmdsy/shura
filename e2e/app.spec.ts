import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installMockProvider, mockRequests, setPlan, unexpectedRequests, type MockRequestRecord } from "./mock-provider";

// Not a credential: the mock provider never leaves the page, and the app only needs a
// non-empty string to build a request.
const FAKE_KEY = "e2e-fake-key";
const SHARED_PLACEHOLDER = "اكتب سؤالك الموحد للجميع…";
const CUSTOM_PLACEHOLDER = "سؤال مخصص لهذا النموذج (فارغ = يرث السؤال الموحد)";
const REPLY = "رد محلي ثابت";
const GPT4O = "openai/gpt-4o";

// The live OpenRouter model catalog is a GET; only POSTs are provider calls.
function posts(records: MockRequestRecord[]): MockRequestRecord[] {
  return records.filter((record) => record.method === "POST");
}

// The operation is over only when the composer offers "send" again and the card carries
// its usage footer: text is painted while a row is still streaming, and a streaming row is
// deliberately not part of the session history.
async function awaitTurnComplete(page: Page, expectedCards: number): Promise<void> {
  await expect(page.getByRole("button", { name: "إرسال" })).toBeVisible();
  await expect(page.getByText("↓ 12")).toHaveCount(expectedCards);
}

function texts(record: MockRequestRecord): string[] {
  const body = record.body as { messages?: { role: string; content: unknown }[] } | null;
  if (!body || !Array.isArray(body.messages)) return [];
  return body.messages.map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)));
}

async function boot(page: Page): Promise<void> {
  await installMockProvider(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "شورى" })).toBeVisible();
}

async function saveFakeKey(page: Page): Promise<void> {
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

async function openNewSession(page: Page): Promise<void> {
  await page.getByRole("button", { name: "جلسة جديدة", exact: true }).first().click();
  await expect(page.getByPlaceholder(SHARED_PLACEHOLDER)).toBeVisible();
}

async function addOpenRouterGpt4o(page: Page): Promise<void> {
  await page.getByRole("button", { name: "إضافة نموذج" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "OpenRouter", exact: true }).click();
  await dialog.getByRole("button", { name: new RegExp(GPT4O) }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("OpenRouter · " + GPT4O)).toBeVisible();
}

async function send(page: Page, prompt: string): Promise<void> {
  await page.getByPlaceholder(SHARED_PLACEHOLDER).fill(prompt);
  await page.getByRole("button", { name: "إرسال" }).click();
}

// A session row is the title button. The rename and delete controls that share the row
// carry their own aria-labels and must never be mistaken for the opener.
function sessionRows(page: Page) {
  return page.getByRole("navigation").locator("button:not([aria-label])");
}

// The polite live-region announcer is sr-only; a result card body is the visible status
// region that actually holds the answer text.
function resultCards(page: Page) {
  return page.locator('[role="status"]:not(.sr-only)');
}

test.beforeEach(async ({ page }) => {
  await boot(page);
  await saveFakeKey(page);
  await openNewSession(page);
  await addOpenRouterGpt4o(page);
});

test("a draft typed in session A never appears in session B", async ({ page }) => {
  const composer = page.getByPlaceholder(SHARED_PLACEHOLDER);
  await composer.fill("مسودة الجلسة الأولى");

  await openNewSession(page);
  await expect(composer).toHaveValue("");
  await composer.fill("مسودة الجلسة الثانية");

  // Back to the first session: the draft is per session, not a single shared field.
  await (await sessionRows(page)).nth(1).click();
  await expect(composer).toHaveValue("مسودة الجلسة الأولى");
});

test("a stopped partial answer and its status survive a reload", async ({ page }) => {
  // One chunk, then the stream stays open: the stop button must be able to interrupt it.
  await setPlan(page, { chunks: [{ text: "جزء أول ", delayMs: 0 }], hang: true });
  await send(page, "سؤال قابل للإيقاف");

  const card = resultCards(page).first();
  await expect(card).toContainText("جزء أول ");
  await page.locator('button[aria-label="إيقاف"]').click();
  await expect(card).toContainText("أُوقف");

  await page.reload();
  await expect(page.getByRole("heading", { name: "شورى" })).toBeVisible();
  await (await sessionRows(page)).first().click();
  const reopened = resultCards(page).first();
  await expect(reopened).toContainText("جزء أول ");
  await expect(reopened).toContainText("أُوقف");
});

test("a retry replays the historical custom prompt, not the current draft", async ({ page }) => {
  // Custom-only turn: the shared switch is off, so the turn carries the custom text.
  await page.getByRole("switch", { name: "سؤال موحد للجميع" }).click();
  await expect(page.getByRole("switch", { name: "سؤال موحد للجميع" })).toHaveAttribute("aria-checked", "false");
  // With the shared switch off the composer offers one focusable row per target; the
  // editor for that target appears once it is focused.
  await page.getByRole("button", { name: /فارغ = يرث الموحد/ }).click();
  const custom = page.getByPlaceholder(CUSTOM_PLACEHOLDER);
  await custom.fill("سؤال مخصص قديم");
  await page.getByRole("button", { name: "إرسال" }).click();
  await awaitTurnComplete(page, 1);

  // The composer now holds different text; the retry must ignore it.
  await custom.fill("سؤال مخصص جديد مختلف تمامًا");
  await page.locator('button[aria-label="إعادة"]').click();
  await awaitTurnComplete(page, 1);

  const requests = posts(await mockRequests(page));
  expect(requests).toHaveLength(2);
  const retry = texts(requests[1]).join("\n");
  expect(retry).toContain("سؤال مخصص قديم");
  expect(retry).not.toContain("لا belongs");
});

test("a stateful follow-up sends the session history to the provider", async ({ page }) => {
  await send(page, "السؤال الأول");
  await awaitTurnComplete(page, 1);
  await send(page, "السؤال الثاني");
  await awaitTurnComplete(page, 2);

  const requests = posts(await mockRequests(page));
  expect(requests).toHaveLength(2);
  const second = texts(requests[1]);
  expect(second.some((text) => text.includes("السؤال الأول"))).toBe(true);
  expect(second.some((text) => text.includes(REPLY))).toBe(true);
  expect(second[second.length - 1]).toContain("السؤال الثاني");
});

test("settings traps focus and Escape returns it to the opener", async ({ page }) => {
  const opener = page.getByRole("button", { name: "الإعدادات" });
  await opener.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("session rows are reachable and activatable with the keyboard only", async ({ page }) => {
  const composer = page.getByPlaceholder(SHARED_PLACEHOLDER);
  await composer.fill("مسودة مميّزة");

  await openNewSession(page);
  await expect(composer).toHaveValue("");

  const rows = await sessionRows(page);
  await rows.nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(composer).toHaveValue("مسودة مميّزة");
});

test("at 390px the layout has no horizontal overflow and the drawer works", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "القائمة" })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByRole("button", { name: "القائمة" }).click();
  await expect(page.getByRole("navigation")).toBeVisible();
  const rows = await sessionRows(page);
  await rows.first().click();
  await expect(page.getByRole("button", { name: "القائمة" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test("model output cannot load a remote resource", async ({ page }) => {
  await setPlan(page, { chunks: [{ text: "![بكسل](https://tracker.invalid/pixel.gif) [رابط](https://tracker.invalid/x)", delayMs: 0 }], hang: false });
  await send(page, "أرسل نصًا يحتوي صورة بعيدة");

  const card = resultCards(page).first();
  await expect(card.getByText("بكسل")).toBeVisible();
  await expect(page.locator("img")).toHaveCount(0);
  await expect(page.getByRole("link")).toHaveCount(0);
  expect(unexpectedRequests(page)).toEqual([]);
});

test("a deleted session does not come back after a reload", async ({ page }) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await send(page, "سؤال قبل الحذف");
  await expect(resultCards(page).first()).toContainText(REPLY);

  const rows = await sessionRows(page);
  await expect(rows).toHaveCount(1);
  await rows.first().locator("xpath=..").getByRole("button", { name: "حذف" }).click();
  await expect(rows).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: "شورى" })).toBeVisible();
  expect(await (await sessionRows(page)).count()).toBe(0);
  await expect(page.getByText(REPLY)).toHaveCount(0);
});

test("the persisted settings record never contains the provider key", async ({ page }) => {
  const stored = await page.evaluate(async () => {
    const open = indexedDB.open("shura");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(new Error("open failed"));
    });
    const tx = db.transaction("settings", "readonly");
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const request = tx.objectStore("settings").getAll();
      request.onsuccess = () => resolve(request.result as unknown[]);
      request.onerror = () => reject(new Error("read failed"));
    });
    db.close();
    return JSON.stringify(rows);
  });
  expect(stored).not.toContain(FAKE_KEY);
});

test("the chat screen and the settings dialog have no serious axe violations", async ({ page }) => {
  const report = async () => {
    const results = await new AxeBuilder({ page }).analyze();
    return results.violations
  };

  const chat = await report();
  expect(chat.filter((item) => item.impact === "critical" || item.impact === "serious").map((item) => item.id), JSON.stringify(chat.map((item) => item.id))).toEqual([]);

  await page.getByRole("button", { name: "الإعدادات" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const settings = await report();
  expect(settings.filter((item) => item.impact === "critical" || item.impact === "serious").map((item) => item.id)).toEqual([]);
});

test("no request ever leaves the machine for a provider origin", async ({ page }) => {
  await send(page, "سؤال عادي");
  await expect(resultCards(page).first()).toContainText(REPLY);
  expect(unexpectedRequests(page)).toEqual([]);
  expect((await mockRequests(page)).length).toBeGreaterThan(0);
});
