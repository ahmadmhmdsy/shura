/*
 * [T6.7 Step 4] One real turn through the packaged desktop app: OpenCode Go.
 *
 * This is the app-level half of the live verification. It runs only under
 * pnpm test:e2e:live (SHURA_LIVE_E2E=1, see playwright.config.ts) and only when
 * the gate finds a key; otherwise it reports SKIPPED and T6.7 records BLOCKED
 * rather than a pass. Nothing is claimed here for the other three providers,
 * which have no key on this machine.
 */
import { expect, test } from "../fixtures";
import { openNewSession, send } from "../app-helpers";
import { liveKey, skipReason } from "./liveGate";
import { addModel, awaitTurn, openApp, playwrightPageOf, seedProviderKey } from "./liveApp";

const PROVIDER = "opencodego" as const;
const PROVIDER_LABEL = "OpenCode Go";
const MODEL_ID = "longcat-2.5-preview-free";
const MODEL_LABEL = "LongCat 2.5 Preview (Free)";
const PROMPT = "أجب بكلمة واحدة فقط: مرحبا";

test.describe("live: OpenCode Go", () => {
  test.beforeEach(() => {
    const reason = skipReason(PROVIDER);
    test.skip(reason !== null, reason ?? undefined);
  });

  test("one real turn through the packaged app returns an answer", async ({ tauriPage }) => {
    test.setTimeout(180_000);
    const page = playwrightPageOf(tauriPage);
    const key = liveKey(PROVIDER);
    // Unreachable while the gate is correct: without a key the test is skipped.
    if (!key) throw new Error("no live key - the gate should have skipped this test");

    await openApp(page);
    await seedProviderKey(page, PROVIDER, key);
    await openNewSession(page);
    await addModel(page, PROVIDER_LABEL, MODEL_LABEL);
    await expect(page.getByText(PROVIDER_LABEL + " · " + MODEL_ID)).toBeVisible();
    await send(page, PROMPT);

    const turn = await awaitTurn(page);
    const alerts = await page.locator("[role=\"status\"][aria-busy]").first().getByRole("alert").allInnerTexts();
    test.info().annotations.push({
      type: "live",
      description:
        "provider=" + PROVIDER + " model=" + MODEL_ID + " usageRecorded=" + String(turn.usageVisible) + " keySource=environment" + " providerError=" + (alerts.join(" | ").slice(0, 200) || "none"),
    });
    expect(alerts, "the provider returned an error instead of an answer").toHaveLength(0);
    expect(turn.answer.length, "the provider returned answer text").toBeGreaterThan(0);
  });
});
