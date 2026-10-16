/**
 * The one owner of the cost string (LV-07 / T3.4).
 *
 * Four surfaces used to build it themselves - the result card, the summary card, the Markdown
 * archive and the session export - each with `"$" + costUSD.toFixed(6)` and a hardcoded "—" for an
 * unknown price. They all go through `formatCost` now, so the currency mark, the number of
 * decimals and the "no price" marker have one owner.
 *
 * The number *shape* is fixed here (six decimals - a cheap model's turn can cost a fraction of a
 * cent). The number *formatting* is injected: the UI passes the locale-aware
 * `UiText.formatNumber`, while the archive and the export keep `stableCostNumber`, whose bytes do
 * not move when the user switches language.
 */

/** The currency mark. USD is the only currency the app reports, so this is a symbol, not text. */
export const CURRENCY_MARK = "$";

/** Six decimals: a cheap model's turn can cost a fraction of a cent. */
export const COST_DECIMALS = 6;

/**
 * The "no price" marker written into the archive and the export. It must equal `common.noValue` in
 * every locale - the resource is what the UI shows and this constant is what the artifacts write -
 * and `cost.spec.ts` pins the equality so the two can never drift.
 */
export const UNKNOWN_COST = "—";

export type NumberFormatter = (value: number, options?: Intl.NumberFormatOptions) => string;

/** Locale-stable formatter for artifacts whose bytes must not follow the UI language. */
export const stableCostNumber: NumberFormatter = (value, options) =>
  value.toFixed(options?.maximumFractionDigits ?? COST_DECIMALS);

/**
 * Format a cost for display or for an artifact. A missing, non-finite price renders `unknown`
 * (never "0" - a price of zero is a real price).
 */
export function formatCost(
  costUSD: number | null | undefined,
  unknown: string,
  formatNumber: NumberFormatter = stableCostNumber,
): string {
  if (costUSD == null || !Number.isFinite(costUSD)) return unknown;
  return CURRENCY_MARK + formatNumber(costUSD, {
    minimumFractionDigits: COST_DECIMALS,
    maximumFractionDigits: COST_DECIMALS,
  });
}
