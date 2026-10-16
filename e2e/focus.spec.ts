import { expect, test, type Page } from "@playwright/test";
import { boot } from "./app-helpers";

/**
 * T5.2 focus-visibility guard.
 *
 * WCAG 2.4.7 is behavioural, so it is checked in the browser rather than in the token table: the
 * global :focus-visible rule in globals.css is the app's single focus indicator, and before T5.2 it
 * was invalid at computed-value time because the token it read (--sura-border-width-focus) was
 * defined nowhere, so the outline computed to "none". axe has no focus-visibility rule, so nothing
 * else in the suite would notice that regression.
 */
const TAB_STEPS = 8;
const MIN_SAMPLES = 5;

interface Indicator {
  tag: string;
  label: string;
  outlineStyle: string;
  outlineWidth: number;
  outlineColor: string;
}

function readIndicator(page: Page): Promise<Indicator | null> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body || !el.matches(":focus-visible")) return null;
    const style = getComputedStyle(el);
    return {
      tag: el.tagName,
      label: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30),
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      outlineColor: style.outlineColor,
    };
  });
}

for (const theme of ["dark", "light"] as const) {
  test("keyboard focus paints a visible indicator (" + theme + ")", async ({ page }) => {
    await boot(page, { theme });
    const problems: string[] = [];
    let samples = 0;
    for (let step = 0; step < TAB_STEPS; step += 1) {
      await page.keyboard.press("Tab");
      const indicator = await readIndicator(page);
      if (!indicator) continue;
      samples += 1;
      const visible = indicator.outlineStyle === "solid" && indicator.outlineWidth >= 2 && indicator.outlineColor !== "rgba(0, 0, 0, 0)";
      if (!visible) {
        problems.push(indicator.tag + " " + JSON.stringify(indicator.label) + " outline=" + indicator.outlineStyle + " " + indicator.outlineWidth + "px " + indicator.outlineColor);
      }
    }
    expect(problems).toEqual([]);
    expect(samples).toBeGreaterThanOrEqual(MIN_SAMPLES);
  });
}
