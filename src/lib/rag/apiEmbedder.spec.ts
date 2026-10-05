import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiEmbedder,
  createApiEmbedder,
  getDefaultEmbeddingModel,
  providerSupportsEmbeddings,
} from "./apiEmbedder";

const mockFetch = vi.fn();

const okResponse = (data: unknown) => ({
  ok: true,
  status: 200,
  statusText: "OK",
  json: async () => data,
});

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ApiEmbedder", () => {
  it("يكشف معرّف النموذج والأبعاد", () => {
    const embedder = new ApiEmbedder({
      providerId: "openrouter",
      apiKey: "k",
      baseURL: "https://api.example.com/v1",
      modelId: "text-embedding-3-small",
      dimensions: 1536,
    });

    expect(embedder.modelId).toBe("text-embedding-3-small");
    expect(embedder.dimensions).toBe(1536);
  });

  it("يضمّن نصًا واحدًا ويعيد أول متجه", async () => {
    mockFetch.mockResolvedValue(okResponse({ data: [{ embedding: [0.1, 0.2] }] }));
    const embedder = createApiEmbedder("openrouter", "k", "https://api.example.com/v1", "m", 2);

    const embedding = await embedder.embed("مرحبا");

    expect(embedding).toEqual([0.1, 0.2]);
  });

  it("يرسل الطلب الصحيح إلى نقطة النهاية /embeddings", async () => {
    mockFetch.mockResolvedValue(okResponse({ data: [{ embedding: [1] }] }));
    const embedder = createApiEmbedder("openrouter", "secret-key", "https://api.example.com/v1", "my-model", 1);

    await embedder.embedBatch(["a", "b"]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/embeddings");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer secret-key",
    });
    expect(JSON.parse(init.body)).toEqual({ model: "my-model", input: ["a", "b"] });
  });

  it("يعيد كل المتجهات في الدفعة", async () => {
    mockFetch.mockResolvedValue(
      okResponse({ data: [{ embedding: [1, 2] }, { embedding: [3, 4] }, { embedding: [5, 6] }] }),
    );
    const embedder = createApiEmbedder("google", "k", "https://g/v1", "m", 2);

    const embeddings = await embedder.embedBatch(["a", "b", "c"]);

    expect(embeddings).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
  });

  it("يعيد مصفوفة فارغة عندما تعيد الواجهة بيانات فارغة", async () => {
    mockFetch.mockResolvedValue(okResponse({ data: [] }));
    const embedder = createApiEmbedder("google", "k", "https://g/v1", "m", 2);

    expect(await embedder.embedBatch([])).toEqual([]);
  });

  it("يرمي خطأ عند استجابة HTTP غير ناجحة", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429, statusText: "Too Many Requests" });
    const embedder = createApiEmbedder("google", "k", "https://g/v1", "m", 2);

    await expect(embedder.embed("x")).rejects.toThrow(
      "Embedding API error: 429 Too Many Requests",
    );
  });

  it("يرمي خطأ عندما تفتقد الاستجابة الحقل data", async () => {
    mockFetch.mockResolvedValue(okResponse({ error: "bad" }));
    const embedder = createApiEmbedder("google", "k", "https://g/v1", "m", 2);

    await expect(embedder.embedBatch(["x"])).rejects.toThrow("Invalid embedding API response");
  });

  it("يرمي خطأ عندما يكون data ليس مصفوفة", async () => {
    mockFetch.mockResolvedValue(okResponse({ data: { embedding: [1] } }));
    const embedder = createApiEmbedder("google", "k", "https://g/v1", "m", 2);

    await expect(embedder.embedBatch(["x"])).rejects.toThrow("Invalid embedding API response");
  });

  it("يمرّر خطأ الشبكة كما هو", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));
    const embedder = createApiEmbedder("google", "k", "https://g/v1", "m", 2);

    await expect(embedder.embed("x")).rejects.toThrow("network down");
  });
});

describe("createApiEmbedder", () => {
  it("يستخدم 384 بعدًا افتراضيًا", () => {
    const embedder = createApiEmbedder("openrouter", "k", "https://api.example.com/v1", "m");

    expect(embedder.dimensions).toBe(384);
    expect(embedder.modelId).toBe("m");
  });
});

describe("providerSupportsEmbeddings", () => {
  it("يقبل المزودين المدعومين", () => {
    for (const provider of ["openrouter", "google", "minimax", "opencodego"]) {
      expect(providerSupportsEmbeddings(provider)).toBe(true);
    }
  });

  it("يرفض المزودين غير المدعومين", () => {
    expect(providerSupportsEmbeddings("anthropic")).toBe(false);
    expect(providerSupportsEmbeddings("")).toBe(false);
  });
});

describe("getDefaultEmbeddingModel", () => {
  it("يعيد النموذج الافتراضي لكل مزود مدعوم", () => {
    expect(getDefaultEmbeddingModel("openrouter")).toEqual({
      modelId: "text-embedding-3-small",
      dimensions: 1536,
    });
    expect(getDefaultEmbeddingModel("google")).toEqual({
      modelId: "text-embedding-004",
      dimensions: 768,
    });
    expect(getDefaultEmbeddingModel("minimax")).toEqual({ modelId: "embo-01", dimensions: 768 });
    expect(getDefaultEmbeddingModel("opencodego")).toEqual({
      modelId: "text-embedding-3-small",
      dimensions: 1536,
    });
  });

  it("يعيد الافتراضي العام للمزود المجهول", () => {
    expect(getDefaultEmbeddingModel("unknown-provider")).toEqual({
      modelId: "text-embedding-3-small",
      dimensions: 1536,
    });
  });
});
