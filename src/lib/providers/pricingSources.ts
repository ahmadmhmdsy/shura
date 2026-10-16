/**
 * Provenance for every non-null static price in `registry.ts` (T7.6/Q7).
 *
 * A price shown to the user must be traceable to a published page. `google/*` and
 * `openrouter/*` were read from the vendor's own pricing page on `asOf`. MiniMax and
 * OpenCode Go publish no readable per-token table, so their models carry
 * `pricing: null` in the registry and appear here not at all.
 *
 * `pricingSources.spec.ts` enforces the bidirectional link: every priced registry
 * model has an entry whose rates match, and no entry is orphaned.
 */
export interface StaticPriceSource {
  /** Published page the rate was read from. */
  readonly url: string;
  /** ISO date the rate was read (provenance freshness). */
  readonly asOf: string;
  readonly inputPerMTok: number;
  readonly outputPerMTok: number;
  /** Optional note: tier, provider-vs-router, etc. */
  readonly note?: string;
}

/** Keyed `${providerId}/${modelId}` - the same pair the registry prices. */
export const STATIC_PRICE_SOURCES: Record<string, StaticPriceSource> = {
  "google/gemini-2.5-pro": {
    url: "https://ai.google.dev/gemini-api/docs/pricing",
    asOf: "2026-10-16",
    inputPerMTok: 1.25,
    outputPerMTok: 10,
    note: "Standard tier, prompts <= 200k tokens. Google charges $2.50/$15 above 200k.",
  },
  "google/gemini-2.5-flash": {
    url: "https://ai.google.dev/gemini-api/docs/pricing",
    asOf: "2026-10-16",
    inputPerMTok: 0.3,
    outputPerMTok: 2.5,
  },
  "openrouter/openai/gpt-4o": {
    url: "https://platform.openai.com/docs/pricing",
    asOf: "2026-10-16",
    inputPerMTok: 2.5,
    outputPerMTok: 10,
    note: "OpenAI list price; OpenRouter routes the same model at provider list price.",
  },
  "openrouter/anthropic/claude-sonnet-4.5": {
    url: "https://www.anthropic.com/pricing",
    asOf: "2026-10-16",
    inputPerMTok: 3,
    outputPerMTok: 15,
    note: "Anthropic list price; OpenRouter routes the same model at provider list price.",
  },
};
