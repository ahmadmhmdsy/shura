import type { Page } from "@playwright/test";

export const PREVIEW_PORT = 4317;
export const PREVIEW_ORIGIN = "http://127.0.0.1:" + PREVIEW_PORT;

/** The four provider origins the app can talk to. Nothing else is ever reachable. */
export const PROVIDER_ORIGINS = [
  "https://openrouter.ai",
  "https://generativelanguage.googleapis.com",
  "https://api.minimax.io",
  "https://opencode.ai",
] as const;

export interface MockChunk {
  text: string;
  /** Delay before this chunk is written, so a stream can be interrupted mid-answer. */
  delayMs: number;
}

export interface MockPlan {
  chunks: MockChunk[];
  /** Keep the response open after the last chunk instead of closing it. */
  hang: boolean;
  /**
   * Answer with this HTTP status and a JSON error body instead of a stream, so the error
   * card can be driven without a network failure. Omitted for the normal 200 stream.
   * The /models catalogue branch runs first, so a status plan never breaks the model list.
   */
  status?: number;
  /**
   * Close the stream after the chunks without the terminal finish chunk. A body that ends
   * with no finish reason is what the app classifies as truncated (measured in T2.2).
   */
  truncate?: boolean;
}

export interface MockRequestRecord {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
  at: number;
}

interface MockClient {
  setPlan(plan: MockPlan): void;
  requests(): MockRequestRecord[];
  reset(): void;
}

interface MockConfig {
  origins: readonly string[];
  defaultPlan: MockPlan;
}

const DEFAULT_PLAN: MockPlan = {
  chunks: [
    { text: "رد ", delayMs: 0 },
    { text: "محلي ", delayMs: 0 },
    { text: "ثابت", delayMs: 0 },
  ],
  hang: false,
};

/*
 * Installed before any application code runs. It replaces window.fetch for the four
 * provider origins with a local SSE responder and records every request body, so the
 * suite can assert history, cancellation, and prompt-faithful retry without a network,
 * an account, or a key. It must stay self-contained: Playwright serializes this
 * function and evaluates it in the page, so it cannot close over module scope.
 */
function installMockClient(config: MockConfig): void {
  const state = { plan: config.defaultPlan as MockPlan, requests: [] as MockRequestRecord[] };
  const originalFetch = window.fetch.bind(window);

  const abortError = (): Error => new DOMException("The operation was aborted.", "AbortError");

  const sleep = (ms: number, signal: AbortSignal | null | undefined): Promise<void> =>
    new Promise((resolve) => {
      if (ms <= 0) { resolve(); return; }
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    });

  const openAiChunk = (model: string, text: string, finish: boolean): unknown => ({
    id: "mock-completion",
    object: "chat.completion.chunk",
    created: 1700000000,
    model,
    choices: [{ index: 0, delta: finish ? {} : { role: "assistant", content: text }, finish_reason: finish ? "stop" : null }],
    ...(finish ? { usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 } } : {}),
  });

  const googleChunk = (model: string, text: string, finish: boolean): unknown => ({
    candidates: [{ content: { role: "model", parts: [{ text }] }, index: 0, finishReason: finish ? "STOP" : null }],
    modelVersion: model,
    ...(finish ? { usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 6, totalTokenCount: 18 } } : {}),
  });

  const sseStream = (url: string, model: string, signal: AbortSignal | null | undefined): ReadableStream<Uint8Array> => {
    const encoder = new TextEncoder();
    const isGoogle = url.indexOf("generativelanguage.googleapis.com") !== -1;
    return new ReadableStream<Uint8Array>({
      // The pump is started from a synchronous start(): an async start() would keep the
      // stream in "starting" state and no chunk could reach the reader until it settled.
      start(controller) {
        const write = (payload: unknown): void => {
          controller.enqueue(encoder.encode("data: " + JSON.stringify(payload) + "\n\n"));
        };
        void (async () => {
          for (const chunk of state.plan.chunks) {
            if (signal?.aborted) { controller.error(abortError()); return; }
            await sleep(chunk.delayMs, signal);
            if (signal?.aborted) { controller.error(abortError()); return; }
            write(isGoogle ? googleChunk(model, chunk.text, false) : openAiChunk(model, chunk.text, false));
          }
          if (state.plan.truncate) { controller.close(); return; }
          if (state.plan.hang) {
            signal?.addEventListener("abort", () => {
              try { controller.error(abortError()); } catch { /* already closed */ }
            }, { once: true });
            return;
          }
          write(isGoogle ? googleChunk(model, "", true) : openAiChunk(model, "", true));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        })();
      },
    });
  };

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!config.origins.some((origin) => url.startsWith(origin))) return originalFetch(input as RequestInfo, init);

    const headers: Record<string, string> = {};
    const raw = init?.headers;
    if (raw instanceof Headers) raw.forEach((value, key) => { headers[key.toLowerCase()] = value; });
    else if (Array.isArray(raw)) for (const pair of raw) headers[String(pair[0]).toLowerCase()] = String(pair[1]);
    else if (raw) for (const [key, value] of Object.entries(raw)) headers[key.toLowerCase()] = String(value);

    let body: unknown = null;
    if (typeof init?.body === "string") {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }

    state.requests.push({ url, method: init?.method ?? "GET", body, headers, at: Date.now() });

    if (/\/models(\?|$)/.test(url)) {
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (typeof state.plan.status === "number") {
      return new Response(JSON.stringify({ error: { message: "mock provider failure", type: "mock_error" } }), {
        status: state.plan.status,
        headers: { "content-type": "application/json" },
      });
    }

    const model = String((body as { model?: unknown } | null)?.model ?? "mock-model");
    return new Response(sseStream(url, model, init?.signal ?? null), {
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
    });
  }) as typeof window.fetch;

  (window as unknown as { __shuraMock: MockClient }).__shuraMock = {
    setPlan(plan) { state.plan = plan; },
    requests() { return state.requests; },
    reset() { state.plan = config.defaultPlan; state.requests = []; },
  };
}

const unexpected = new Map<Page, string[]>();

export async function installMockProvider(page: Page): Promise<void> {
  unexpected.set(page, []);
  await page.addInitScript(installMockClient, { origins: PROVIDER_ORIGINS, defaultPlan: DEFAULT_PLAN } satisfies MockConfig);
  // Safety net: nothing outside the local preview origin may reach the network, whatever
  // the page does. Anything that tries is recorded and aborted.
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith(PREVIEW_ORIGIN)) {
      await route.continue();
      return;
    }
    unexpected.get(page)?.push(url);
    await route.abort();
  });
}

export async function setPlan(page: Page, plan: MockPlan): Promise<void> {
  await page.evaluate((next) => {
    (window as unknown as { __shuraMock: MockClient }).__shuraMock.setPlan(next);
  }, plan);
}

export async function mockRequests(page: Page): Promise<MockRequestRecord[]> {
  return page.evaluate(() => (window as unknown as { __shuraMock: MockClient }).__shuraMock.requests());
}

export async function resetMock(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __shuraMock: MockClient }).__shuraMock.reset());
}

export function unexpectedRequests(page: Page): string[] {
  return unexpected.get(page) ?? [];
}
