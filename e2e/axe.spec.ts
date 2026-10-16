import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { addOpenRouterGpt4o, boot, openNewSession, resultCards, saveFakeKey, send } from "./app-helpers";
import { setPlan } from "./mock-provider";

// [T5.1] Measure the resting UI. The app honours prefers-reduced-motion (globals.css),
// which also removes Sonner's entrance fade - a half-faded toast composites to a colour
// that is not on screen long enough to matter, but is a false positive for axe.
test.use({ reducedMotion: "reduce" });

/*
 * [T5.1] The automated accessibility pass: one test per screen and state, so a failure names
 * the state it belongs to. The assertion message always carries the full violation list, not
 * just the serious ones - an accepted exception is only reviewable when the rule, its impact
 * and its node count are visible.
 */
async function expectNoSeriousViolations(page: Page, state: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((item) => item.impact === "critical" || item.impact === "serious");
  const targets = serious.map((item) => item.id + " -> " + item.nodes.map((node) => node.target.join(" ")).join(", "));
  const all = results.violations.map((item) => item.id + "[" + item.impact + ", " + item.nodes.length + " node(s)]");
  expect(serious.map((item) => item.id), "axe " + state + " | serious/critical: " + JSON.stringify(targets) + " | all violations: " + JSON.stringify(all)).toEqual([]);
}

test("the first-run empty state has no serious axe violations", async ({ page }) => {
  await boot(page);
  // No session exists yet, so the shell shows its empty state instead of a transcript.
  await expect(page.getByRole("heading", { name: "ابدأ محادثة جديدة" })).toBeVisible();
  await expectNoSeriousViolations(page, "first run");
});

test.describe("with one session and one model", () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
    await saveFakeKey(page);
    await openNewSession(page);
    await addOpenRouterGpt4o(page);
  });

  test("the empty transcript and the settings dialog have no serious axe violations", async ({ page }) => {
    await expectNoSeriousViolations(page, "empty transcript");
    await page.getByRole("button", { name: "الإعدادات" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoSeriousViolations(page, "settings dialog");
  });

  test("the RAG panes expanded in settings have no serious axe violations", async ({ page }) => {
    await page.getByRole("button", { name: "الإعدادات" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    // A collapsed section renders no children, so each pane has to be opened first. The
    // section ids are the locale-independent anchors; the visible titles change with language.
    for (const id of ["rag-settings", "rag-files", "rag-external"]) {
      const trigger = page.locator("#section-" + id + " > button");
      await trigger.click();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
    }
    await expectNoSeriousViolations(page, "settings RAG panes");
  });

  test("a streaming answer has no serious axe violations", async ({ page }) => {
    await setPlan(page, { chunks: [{ text: "جزء أول ", delayMs: 0 }], hang: true });
    await send(page, "سؤال أثناء البث");
    await expect(resultCards(page).first()).toContainText("جزء أول ");
    await expect(page.locator('button[aria-label="إيقاف"]')).toBeVisible();
    await expectNoSeriousViolations(page, "streaming answer");
    await page.locator('button[aria-label="إيقاف"]').click();
  });

  test("a provider error card has no serious axe violations", async ({ page }) => {
    await setPlan(page, { chunks: [], hang: false, status: 500 });
    await send(page, "سؤال يفشل");
    await expect(resultCards(page).first().getByRole("alert")).toBeVisible();
    await expect(page.locator("li[data-sonner-toast]").first()).toBeVisible();
    await expectNoSeriousViolations(page, "provider error");
  });

  test("a truncated answer has no serious axe violations", async ({ page }) => {
    await setPlan(page, { chunks: [{ text: "نص مقطوع ", delayMs: 0 }], hang: false, truncate: true });
    await send(page, "سؤال مبتور");
    await expect(resultCards(page).first()).toContainText("غير مكتمل");
    await expectNoSeriousViolations(page, "truncated answer");
  });

  test("the export dialog has no serious axe violations", async ({ page }) => {
    await page.getByRole("button", { name: "تصدير الجلسة" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoSeriousViolations(page, "export dialog");
  });
});

test.describe("with the light theme", () => {
  test.beforeEach(async ({ page }) => {
    await boot(page, { theme: "light" });
    await saveFakeKey(page);
    await openNewSession(page);
    await addOpenRouterGpt4o(page);
  });

  test("the stop button hover and the error toast pass in light mode", async ({ page }) => {
    // The dark run only reached the stop button because the pointer rests on it after
    // send; the light palette is measured on purpose, so a danger pair that works in
    // one theme cannot pass the suite.
    await setPlan(page, { chunks: [{ text: "جزء ", delayMs: 0 }], hang: true });
    await send(page, "سؤال أثناء البث");
    await expect(resultCards(page).first()).toContainText("جزء ");
    await page.locator('button[data-variant="destructive"][data-size="sm"]').hover();
    await expectNoSeriousViolations(page, "light streaming stop button");
    await page.locator('button[aria-label="إيقاف"]').click();
  });

  test("the error toast passes in light mode", async ({ page }) => {
    await setPlan(page, { chunks: [], hang: false, status: 500 });
    await send(page, "سؤال يفشل");
    await expect(page.locator("li[data-sonner-toast]").first()).toBeVisible();
    await expectNoSeriousViolations(page, "light provider error");
  });
});
