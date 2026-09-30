import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted so the mock factory can reference the spies (vi.mock is hoisted too).
const { mockCreateSession, mockFetch } = vi.hoisted(() => ({
  mockCreateSession: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock("onnxruntime-web", () => ({
  env: { wasm: { wasmPaths: "" } },
  InferenceSession: {
    create: (...args: unknown[]) => mockCreateSession(...args),
  },
  Tensor: class {
    constructor(
      public type: string,
      public data: unknown,
      public dims: number[],
    ) {}
  },
}));

/** Import a fresh embedder module so each test starts with an empty model cache. */
async function importEmbedder() {
  return import("./embedder");
}

/** Successful fetch response standing in for the downloaded model bytes. */
const okModelResponse = () => ({
  ok: true,
  status: 200,
  statusText: "OK",
  arrayBuffer: async () => new ArrayBuffer(16),
});

describe("lazy embedding model loading", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateSession.mockReset();
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("لا يحمّل النموذج عند الاستيراد أو إنشاء المضمّن (تحميل كسول)", async () => {
    const { OnnxEmbedder, isModelLoaded } = await importEmbedder();

    expect(isModelLoaded()).toBe(false);
    const embedder = new OnnxEmbedder("multilingual-e5-small", 384);

    expect(isModelLoaded()).toBe(false);
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(embedder.modelId).toBe("multilingual-e5-small");
    expect(embedder.dimensions).toBe(384);
  });

  it("loadEmbeddingModel يحمّل النموذج عند أول استخدام ويُحدّث isModelLoaded", async () => {
    mockCreateSession.mockResolvedValue({ run: async () => ({}) });
    mockFetch.mockResolvedValue(okModelResponse());

    const { loadEmbeddingModel, isModelLoaded, getModelLoadError } = await importEmbedder();
    expect(isModelLoaded()).toBe(false);
    expect(getModelLoadError()).toBeNull();

    await loadEmbeddingModel("multilingual-e5-small", 384);

    expect(isModelLoaded()).toBe(true);
    expect(getModelLoadError()).toBeNull();
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
  });

  it("يخزّن النموذج المحمّل: الاستدعاءات المتكررة لا تعيد التحميل", async () => {
    mockCreateSession.mockResolvedValue({ run: async () => ({}) });
    mockFetch.mockResolvedValue(okModelResponse());

    const { loadEmbeddingModel, isModelLoaded } = await importEmbedder();

    await loadEmbeddingModel("multilingual-e5-small", 384);
    await loadEmbeddingModel("multilingual-e5-small", 384);
    await loadEmbeddingModel("multilingual-e5-small", 384);

    expect(isModelLoaded()).toBe(true);
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
  });

  it("embed() يشغّل التحميل الكسول وتشارك النسخ المتعددة الجلسة المحمّلة", async () => {
    mockCreateSession.mockResolvedValue({
      run: async () => ({
        last_hidden_state: {
          dims: [1, 3, 384],
          data: new Float32Array(3 * 384).fill(0.5),
        },
      }),
    });
    mockFetch.mockResolvedValue(okModelResponse());

    const { OnnxEmbedder, isModelLoaded } = await importEmbedder();
    const first = new OnnxEmbedder("multilingual-e5-small", 384);
    const second = new OnnxEmbedder("multilingual-e5-small", 384);

    const [firstEmbedding, secondEmbedding] = await Promise.all([
      first.embed("مرحبا"),
      second.embed("عالم"),
    ]);

    expect(isModelLoaded()).toBe(true);
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    expect(firstEmbedding).toHaveLength(384);
    expect(secondEmbedding).toHaveLength(384);
  });

  it("فشل التحميل: يرمي الخطأ ويُخزّنه في getModelLoadError دون تخزين النموذج", async () => {
    mockCreateSession.mockRejectedValue(new Error("inference failed"));
    mockFetch.mockResolvedValue(okModelResponse());

    const { loadEmbeddingModel, isModelLoaded, getModelLoadError } = await importEmbedder();

    await expect(loadEmbeddingModel("multilingual-e5-small", 384)).rejects.toThrow("inference failed");

    expect(isModelLoaded()).toBe(false);
    const loadError = getModelLoadError();
    expect(loadError).toBeInstanceOf(Error);
    expect(loadError?.message).toBe("inference failed");
  });

  it("فشل تنزيل النموذج (استجابة غير ناجحة) يُعامل كخطأ تحميل", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      arrayBuffer: async () => new ArrayBuffer(0),
    });

    const { loadEmbeddingModel, isModelLoaded, getModelLoadError } = await importEmbedder();

    await expect(loadEmbeddingModel("multilingual-e5-small", 384)).rejects.toThrow(/404/);

    expect(isModelLoaded()).toBe(false);
    expect(getModelLoadError()).not.toBeNull();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("بعد الفشل يمكن إعادة المحاولة والنجاح", async () => {
    mockCreateSession
      .mockRejectedValueOnce(new Error("transient network error"))
      .mockResolvedValue({ run: async () => ({}) });
    mockFetch.mockResolvedValue(okModelResponse());

    const { loadEmbeddingModel, isModelLoaded, getModelLoadError } = await importEmbedder();

    await expect(loadEmbeddingModel("multilingual-e5-small", 384)).rejects.toThrow("transient network error");
    expect(isModelLoaded()).toBe(false);

    await loadEmbeddingModel("multilingual-e5-small", 384);

    expect(isModelLoaded()).toBe(true);
    expect(getModelLoadError()).toBeNull();
    expect(mockCreateSession).toHaveBeenCalledTimes(2);
  });

  it("embed() يرمي خطأ التحميل عندما يفشل النموذج", async () => {
    mockCreateSession.mockRejectedValue(new Error("boom"));
    mockFetch.mockResolvedValue(okModelResponse());

    const { OnnxEmbedder } = await importEmbedder();
    const embedder = new OnnxEmbedder("multilingual-e5-small", 384);

    await expect(embedder.embed("مرحبا")).rejects.toThrow("boom");
  });
});
