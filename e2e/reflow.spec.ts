/*
 * [T5.3] Reflow (WCAG 1.4.10): at 320x720 - the width the criterion names, equivalent to 400%
 * zoom on a 1280px desktop - no screen may need horizontal scrolling and no control may sit
 * outside the viewport. Dialogs are measured separately because they are position: fixed, so
 * their overflow never appears in document.scrollWidth: the settings dialog scrolled sideways
 * at 320px while the document measured clean.
 */
import { expect, test, type Page } from "@playwright/test";
import { addOpenRouterGpt4o, awaitTurnComplete, boot, openNewSession, saveFakeKey, send } from "./app-helpers";

test.use({ reducedMotion: "reduce" });

const NARROW = { width: 320, height: 720 };
const WIDE = { width: 1280, height: 800 };

interface Report { scrollWidth: number; clientWidth: number; offscreen: string[]; }

function describe(label: string, report: Report): string {
  return label + ": scrollWidth " + report.scrollWidth + " > clientWidth " + report.clientWidth + " | outside the viewport: " + JSON.stringify(report.offscreen);
}

async function documentReport(page: Page): Promise<Report> {
  return page.evaluate(() => {
    const offscreen: string[] = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.clipPath.includes("inset(50%)")) continue;
      if (box.left < -1 || box.right > window.innerWidth + 1) {
        offscreen.push(el.tagName.toLowerCase() + "." + String(el.className || "").split(" ").slice(0, 2).join("."));
      }
    }
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, offscreen: offscreen.slice(0, 5) };
  });
}

async function dialogReport(page: Page): Promise<Report | null> {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement | null;
    if (!dialog) return null;
    const offscreen: string[] = [];
    for (const el of Array.from(dialog.querySelectorAll("button, input, select, a, [role=switch]"))) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.left < -1 || box.right > window.innerWidth + 1) {
        offscreen.push(el.getAttribute("aria-label") || (el.textContent || "").trim().slice(0, 24) || el.tagName.toLowerCase());
      }
    }
    return { scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth, offscreen: offscreen.slice(0, 5) };
  });
}

test("the transcript reflows to 320px without horizontal scrolling", async ({ page }) => {
  await page.setViewportSize(WIDE);
  await boot(page);
  await saveFakeKey(page);
  await openNewSession(page);
  await addOpenRouterGpt4o(page);
  await send(page, "سؤال لقياس الانسياب");
  await awaitTurnComplete(page, 1);
  await page.setViewportSize(NARROW);
  const report = await documentReport(page);
  expect(report.offscreen, describe("transcript at 320px", report)).toEqual([]);
  expect(report.scrollWidth, describe("transcript at 320px", report)).toBeLessThanOrEqual(NARROW.width + 1);
});

test("the settings and shortcut dialogs reflow to 320px without horizontal scrolling", async ({ page }) => {
  await page.setViewportSize(WIDE);
  await boot(page);
  await page.setViewportSize(NARROW);
  const cases: { label: string; open: () => Promise<void> }[] = [
    { label: "settings dialog at 320px", open: async () => { await page.keyboard.press("Control+,"); } },
    { label: "shortcut dialog at 320px", open: async () => { await page.locator("body").press("?"); } },
  ];
  for (const item of cases) {
    await item.open();
    await expect(page.getByRole("dialog")).toBeVisible();
    const report = await dialogReport(page);
    expect(report, item.label + ": no dialog element was measurable").not.toBeNull();
    if (report) {
      expect(report.offscreen, describe(item.label, report)).toEqual([]);
      expect(report.scrollWidth, describe(item.label, report)).toBeLessThanOrEqual(report.clientWidth + 1);
    }
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  }
});
