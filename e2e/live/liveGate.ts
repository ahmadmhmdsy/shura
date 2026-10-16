/*
 * [T6.7] The gate for the opt-in live suite.
 *
 * The live specs talk to real providers with a real key. They must not run by
 * accident: not in CI, not in a default "pnpm test:e2e", and not on a machine
 * where the key is missing. So the switch decides whether the Playwright project
 * exists at all (playwright.config.ts), and a missing key means SKIPPED, never
 * FAIL.
 *
 * Nothing here returns, logs or annotates a key value; the helpers report the
 * variable NAMES and whether they are present.
 */

export const LIVE_SWITCH = "SHURA_LIVE_E2E";

/** One live key per provider. Only the name is ever reported. */
export const LIVE_KEY_ENV = {
  opencodego: "SHURA_LIVE_OPENCODE_KEY",
  openrouter: "SHURA_LIVE_OPENROUTER_KEY",
  gemini: "SHURA_LIVE_GEMINI_KEY",
  minimax: "SHURA_LIVE_MINIMAX_KEY",
} as const;

export type LiveProviderId = keyof typeof LIVE_KEY_ENV;

/**
 * The OpenCode Go key already lives in .env as OPENCODE_API_KEY (Q5, 2026-10-11),
 * so it is read from there rather than duplicated under a second name. That file
 * is gitignored and untracked, which is what the plan means by never reading a
 * committed file.
 */
const FALLBACK_ENV: Partial<Record<LiveProviderId, string>> = { opencodego: "OPENCODE_API_KEY" };

export function liveSwitchOn(): boolean {
  return process.env[LIVE_SWITCH] === "1";
}

/** The variable names a provider accepts a key from, most specific first. */
export function liveKeyEnvNames(provider: LiveProviderId): string[] {
  const fallback = FALLBACK_ENV[provider];
  return fallback ? [LIVE_KEY_ENV[provider], fallback] : [LIVE_KEY_ENV[provider]];
}

export function liveKey(provider: LiveProviderId): string | null {
  for (const name of liveKeyEnvNames(provider)) {
    const value = process.env[name];
    if (value && value.trim().length > 0) return value;
  }
  return null;
}

/** Null when the provider may be tested live; otherwise the reason to SKIP. */
export function skipReason(provider: LiveProviderId): string | null {
  if (!liveSwitchOn()) {
    return "live suite is off - run pnpm test:e2e:live to set " + LIVE_SWITCH + "=1";
  }
  if (!liveKey(provider)) {
    return "no key in " + liveKeyEnvNames(provider).join(" or ") + " - skipped, not failed";
  }
  return null;
}

/** Presence only, so it is safe to print. */
export function keyPresence(): { provider: LiveProviderId; names: string[]; present: boolean }[] {
  return (Object.keys(LIVE_KEY_ENV) as LiveProviderId[]).map((provider) => ({
    provider,
    names: liveKeyEnvNames(provider),
    present: liveKey(provider) !== null,
  }));
}
