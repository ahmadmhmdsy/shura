import { expect, test } from "@playwright/test";
import { mockRequests, setPlan, unexpectedRequests } from "./mock-provider";
import {
  addOpenRouterGpt4o,
  awaitTurnComplete,
  boot,
  CUSTOM_PLACEHOLDER,
  FAKE_KEY,
  openNewSession,
  posts,
  REPLY,
  resultCards,
  saveFakeKey,
  send,
  sessionRows,
  SHARED_PLACEHOLDER,
  texts,
} from "./app-helpers";

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
  // The per-target editor lives in the advanced panel, which is collapsed by default.
  await page.getByRole("button", { name: "خيارات متقدمة" }).click();
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
  // Scoped to the card: the app ships its own skip link, so a page-wide link count is
  // never zero. What the test is about is that the model output yielded neither.
  await expect(card.locator("img")).toHaveCount(0);
  await expect(card.getByRole("link")).toHaveCount(0);
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

test("no request ever leaves the machine for a provider origin", async ({ page }) => {
  await send(page, "سؤال عادي");
  await expect(resultCards(page).first()).toContainText(REPLY);
  expect(unexpectedRequests(page)).toEqual([]);
  expect((await mockRequests(page)).length).toBeGreaterThan(0);
});
