import { getProvider, type FetchLike } from "./registry";
import { getTransportFetch } from "@/lib/transport/transport";
import { KeyedError } from "@/lib/errors/keyedError";
import type { ModelInfo, ModelPricing, ProviderId } from "@/types";

const DEFAULT_TIMEOUT_MS = 10_000;

interface CatalogEntry {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown; input_cache_read?: unknown; input_cache_write?: unknown } | null;
}

// A live catalog is untrusted input: only finite, non-negative numbers survive, so a
// malformed provider response degrades to "no price" instead of a corrupt invoice.
function rate(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

// Per-token prices are fractions of a cent; rounding to nine decimals removes binary
// artifacts such as 0.19999999999999998 without changing any real published rate.
function pricePerMTok(perToken: number): number {
  return Math.round(perToken * 1e6 * 1e9) / 1e9;
}

export function normalizeModelEntry(entry: CatalogEntry): ModelInfo | null {
  if (typeof entry.id !== "string" || !entry.id.trim()) return null;
  const inputPerMTok = rate(entry.pricing?.prompt);
  const outputPerMTok = rate(entry.pricing?.completion);
  const cacheRead = rate(entry.pricing?.input_cache_read);
  const cacheWrite = rate(entry.pricing?.input_cache_write);
  const pricing: ModelPricing | null = inputPerMTok !== undefined && outputPerMTok !== undefined
    ? {
        inputPerMTok: pricePerMTok(inputPerMTok),
        outputPerMTok: pricePerMTok(outputPerMTok),
        ...(cacheRead !== undefined ? { cacheReadPerMTok: pricePerMTok(cacheRead) } : {}),
        ...(cacheWrite !== undefined ? { cacheWritePerMTok: pricePerMTok(cacheWrite) } : {}),
      }
    : null;
  const label = typeof entry.name === "string" && entry.name.trim() ? entry.name : entry.id;
  const contextLength = positive(entry.context_length);
  return { id: entry.id, label, ...(contextLength !== undefined ? { contextLength } : {}), pricing };
}

export interface FetchModelCatalogOptions {
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** [T2.8/LV-04] مفتاح المزود حين تكون قائمته مرتبطة بالاستحقاق؛ يُرسَل ترويسة Authorization. */
  apiKey?: string;
}

export async function fetchModelCatalog(providerId: ProviderId, options: FetchModelCatalogOptions = {}): Promise<ModelInfo[]> {
  const provider = getProvider(providerId);
  if (provider.modelsSource !== "live" || !provider.liveModelsUrl) {
    throw new KeyedError("errors.catalogNotLive", { provider: provider.label });
  }
  // [T2.8/LV-04] قائمة مرتبطة بالاستحقاق: النداء المجهول يعيد معرّفات لا يملك المفتاح حقّها،
  // فيُرفض النداء بلا مفتاح بدل عرض قائمة مضلِّلة يعقبها 401 عند أول سؤال.
  const apiKey = options.apiKey?.trim() ?? "";
  if (provider.catalogNeedsKey && !apiKey) {
    throw new KeyedError("errors.catalogNeedsKey", { provider: provider.label });
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const external = options.signal;
  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", onExternalAbort, { once: true });
  }
  // The race guarantees the timeout even if the transport ignores the abort signal,
  // so a hung provider can never leave the model dialog spinning forever.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new KeyedError("errors.catalogTimeout", { ms: timeoutMs }));
    }, timeoutMs);
  });
  try {
    const response = await Promise.race([
      (options.fetchImpl ?? getTransportFetch())(provider.liveModelsUrl, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          // [T2.8/LV-04] مفتاح المزود يُرسل فقط إلى قائمة تحتاجه؛ القائمة العامة تبقى مجهولة.
          ...(provider.catalogNeedsKey ? { Authorization: "Bearer " + apiKey } : {}),
        },
      }),
      timeout,
    ]);
    if (!response.ok) throw new KeyedError("errors.catalogFetchFailed", { status: response.status });
    const body = (await response.json()) as { data?: unknown };
    const rows = Array.isArray(body.data) ? (body.data as CatalogEntry[]) : [];
    return rows.map(normalizeModelEntry).filter((model): model is ModelInfo => model !== null);
  } finally {
    if (timer) clearTimeout(timer);
    external?.removeEventListener("abort", onExternalAbort);
  }
}
