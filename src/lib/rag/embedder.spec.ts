/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { getModelInfo } from "./modelCatalog";

// Hoisted so the mock factory can reference the spies (vi.mock is hoisted too).
const { mockCreateSession, mockFetch } = vi.hoisted(() => ({
  mockCreateSession: vi.fn(),
  mockFetch: vi.fn(),
}));

// Fixture bytes are not the pinned files; verifiedDownload.spec.ts covers the real check.
vi.mock("./verifiedDownload", () => ({ assertWithinSize: vi.fn(), verifyDigest: vi.fn(async () => {}) }));

vi.mock("onnxruntime-web/wasm", () => ({
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

/**
 * حد أدنى صالح من ملف المُرمِّز، بمعرّفات معروفة سلفًا: `hello` = 4 و`world` = 5.
 * الشكل يحاكي عائلة المُرمِّزات المستخدمة فعليًا: تطبيع BERT، تقطيع مسبق بالكلمات،
 * ومعالج لاحق قالبِيّ يضيف <s> في البداية و</s> في النهاية.
 */
const FIXTURE_TOKENIZER_JSON = {
  version: "1.0",
  truncation: null,
  padding: null,
  added_tokens: [
    { id: 0, content: "<s>", single_word: false, lstrip: false, rstrip: false, normalized: false, special: true },
    { id: 1, content: "<pad>", single_word: false, lstrip: false, rstrip: false, normalized: false, special: true },
    { id: 2, content: "</s>", single_word: false, lstrip: false, rstrip: false, normalized: false, special: true },
    { id: 3, content: "<unk>", single_word: false, lstrip: false, rstrip: false, normalized: false, special: true },
  ],
  normalizer: { type: "BertNormalizer", clean_text: true, handle_chinese_chars: true, strip_accents: null, lowercase: true },
  pre_tokenizer: { type: "BertPreTokenizer" },
  post_processor: {
    type: "TemplateProcessing",
    // القالب في الملفات الحقيقية يستعمل { Sequence: { id: "A" } } لا السلسلة "$A":
    // مُرمِّز المكتبة يبحث عن المفتاح Sequence داخل الكائن، والسلسلة ترمي TypeError.
    single: [
      { SpecialToken: { id: "<s>", type_id: 0 } },
      { Sequence: { id: "A", type_id: 0 } },
      { SpecialToken: { id: "</s>", type_id: 0 } },
    ],
    pair: [],
    special_tokens: {
      "<s>": { id: "<s>", ids: [0], tokens: ["<s>"] },
      "</s>": { id: "</s>", ids: [2], tokens: ["</s>"] },
    },
  },
  decoder: { type: "WordPiece", prefix: "##", cleanup: true },
  model: {
    type: "WordPiece",
    unk_token: "<unk>",
    continuing_subword_prefix: "##",
    max_input_chars_per_word: 100,
    vocab: { "<s>": 0, "<pad>": 1, "</s>": 2, "<unk>": 3, hello: 4, world: 5 },
  },
};

const FIXTURE_TOKENIZER_CONFIG = {
  tokenizer_class: "XLMRobertaTokenizer",
  bos_token: "<s>",
  eos_token: "</s>",
  unk_token: "<unk>",
  pad_token: "<pad>",
  model_max_length: 512,
};

/** بايتات النموذج في الاختبارات: يكفي أن تكون ArrayBuffer غير فارغ. */
const MODEL_BYTES = new ArrayBuffer(16);

/** يسدّ كل روابط التنزيل: بايتات ONNX للنموذج ونص JSON لملفَّي المُرمِّز. */
/** عدد تنزيلات بايتات النموذج وحدها: ملفّا المُرمِّز لا يدخلان في هذا العدّ. */
const modelDownloads = () =>
  mockFetch.mock.calls.filter((call) => String(call[0]).endsWith(".onnx")).length;

const serveDownloads = async (input: unknown) => {
  const url = String(input);
  const bytes = url.endsWith(".onnx")
    ? MODEL_BYTES
    : new TextEncoder().encode(
        JSON.stringify(url.endsWith("tokenizer_config.json") ? FIXTURE_TOKENIZER_CONFIG : FIXTURE_TOKENIZER_JSON),
      ).buffer;
  return { ok: true, status: 200, statusText: "OK", arrayBuffer: async () => bytes };
};

describe("lazy embedding model loading", () => {
  beforeEach(async () => {
    vi.resetModules();
    // يُستورد بعد resetModules ليكون نفس نسخة الوحدة التي سيستوردها embedder،
    // فلا ينشأ اتصالان مختلفان بقاعدة البيانات.
    const { db } = await import("@/lib/db/db");
    await db.rag_models.clear();
    await db.rag_model_blobs.clear();
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
    mockFetch.mockImplementation(serveDownloads);

    const { loadEmbeddingModel, isModelLoaded, getModelLoadError } = await importEmbedder();
    expect(isModelLoaded()).toBe(false);
    expect(getModelLoadError()).toBeNull();

    await loadEmbeddingModel("multilingual-e5-small");

    expect(isModelLoaded()).toBe(true);
    expect(getModelLoadError()).toBeNull();
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
  });

  it("يخزّن النموذج المحمّل: الاستدعاءات المتكررة لا تعيد التحميل", async () => {
    mockCreateSession.mockResolvedValue({ run: async () => ({}) });
    mockFetch.mockImplementation(serveDownloads);

    const { loadEmbeddingModel, isModelLoaded } = await importEmbedder();

    await loadEmbeddingModel("multilingual-e5-small");
    await loadEmbeddingModel("multilingual-e5-small");
    await loadEmbeddingModel("multilingual-e5-small");

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
    mockFetch.mockImplementation(serveDownloads);

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
    mockFetch.mockImplementation(serveDownloads);

    const { loadEmbeddingModel, isModelLoaded, getModelLoadError } = await importEmbedder();

    await expect(loadEmbeddingModel("multilingual-e5-small")).rejects.toThrow("inference failed");

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

    await expect(loadEmbeddingModel("multilingual-e5-small")).rejects.toThrow(/404/);

    expect(isModelLoaded()).toBe(false);
    expect(getModelLoadError()).not.toBeNull();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("بعد الفشل يمكن إعادة المحاولة والنجاح", async () => {
    mockCreateSession
      .mockRejectedValueOnce(new Error("transient network error"))
      .mockResolvedValue({ run: async () => ({}) });
    mockFetch.mockImplementation(serveDownloads);

    const { loadEmbeddingModel, isModelLoaded, getModelLoadError } = await importEmbedder();

    await expect(loadEmbeddingModel("multilingual-e5-small")).rejects.toThrow("transient network error");
    expect(isModelLoaded()).toBe(false);

    await loadEmbeddingModel("multilingual-e5-small");

    expect(isModelLoaded()).toBe(true);
    expect(getModelLoadError()).toBeNull();
    expect(mockCreateSession).toHaveBeenCalledTimes(2);
  });

  it("embed() يرمي خطأ التحميل عندما يفشل النموذج", async () => {
    mockCreateSession.mockRejectedValue(new Error("boom"));
    mockFetch.mockImplementation(serveDownloads);

    const { OnnxEmbedder } = await importEmbedder();
    const embedder = new OnnxEmbedder("multilingual-e5-small", 384);

    await expect(embedder.embed("مرحبا")).rejects.toThrow("boom");
  });

  it("يستخدم كاش IndexedDB ولا يعيد تنزيل نموذج سبق تنزيله", async () => {
    mockCreateSession.mockResolvedValue({ run: async () => ({}) });
    mockFetch.mockImplementation(serveDownloads);

    const { loadEmbeddingModel } = await importEmbedder();

    await loadEmbeddingModel("multilingual-e5-small");
    expect(modelDownloads()).toBe(1);

    // تحميل نموذج آخر يُزيح الكاش في الذاكرة، فيبقى كاش IndexedDB هو الحائل
    // الوحيد دون إعادة تنزيل النموذج الأول — وهو ما كان معطوبًا: كتابة بلا قراءة،
    // أي إعادة تنزيل مئات الميغابايتات في كل جلسة.
    await loadEmbeddingModel("all-MiniLM-L6-v2");
    expect(modelDownloads()).toBe(2);

    await loadEmbeddingModel("multilingual-e5-small");

    expect(modelDownloads()).toBe(2);
  });

  it("صف وصفي بلا بايتات (كاش ناقص): يعيد التنزيل بدل الفشل", async () => {
    const { db } = await import("@/lib/db/db");
    await db.rag_models.put({
      id: "multilingual-e5-small",
      modelId: "multilingual-e5-small",
      label: "x",
      dimensions: 384,
      downloadedAt: 1,
      sizeBytes: 16,
    });
    mockCreateSession.mockResolvedValue({ run: async () => ({}) });
    mockFetch.mockImplementation(serveDownloads);

    const { loadEmbeddingModel } = await importEmbedder();
    await loadEmbeddingModel("multilingual-e5-small");

    expect(modelDownloads()).toBe(1);
    expect((await db.rag_model_blobs.get("multilingual-e5-small"))?.bytes.byteLength).toBe(16);
    // وملفّا المُرمِّز حُفظا في الكاش أيضًا
    expect(await db.rag_model_blobs.get("tokenizer:multilingual-e5-small:tokenizer.json")).toBeDefined();
  });

  it("صف الكاش يأتي من الكتالوج لا من المستدعي (T1.6، NL-05)", async () => {
    mockCreateSession.mockResolvedValue({ run: async () => ({}) });
    mockFetch.mockImplementation(serveDownloads);

    const { loadEmbeddingModel } = await importEmbedder();
    await loadEmbeddingModel("multilingual-e5-small");

    const { db } = await import("@/lib/db/db");
    const catalog = getModelInfo("multilingual-e5-small")!;
    const stored = await db.rag_models.get("multilingual-e5-small");

    // كان هذا المسار يكتب معرّف النموذج تسميةً وأبعادًا قدّمها المستدعي، فيختلف
    // الصف عن صف مسار التنزيل للنموذج نفسه (NL-05).
    expect(stored?.label).toBe(catalog.label);
    expect(stored?.dimensions).toBe(catalog.dimensions);
    expect(stored?.modelId).toBe("multilingual-e5-small");
  });
});


// ---------------------------------------------------------------------------
// T1.1 - مُرمِّز حقيقي: يقرأ المفردات من tokenizer.json بدل تقسيم المسافات (NH-01a)
// ---------------------------------------------------------------------------

/** استيراد وحدة جديدة بكاش فارغ، ثم إعادة تسليح روابط التنزيل. */
async function freshEmbedder() {
  vi.resetModules();
  const { db } = await import("@/lib/db/db");
  await db.rag_models.clear();
  await db.rag_model_blobs.clear();
  mockFetch.mockReset();
  mockFetch.mockImplementation(serveDownloads);
  vi.stubGlobal("fetch", mockFetch);
  return import("./embedder");
}

describe("مطابقة المُرمِّز (T1.1)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("يقرأ المفردات من tokenizer.json ولا يخترع معرّفات من عدّاد داخلي", async () => {
    const { loadTokenizer } = await freshEmbedder();
    const tokenizer = await loadTokenizer("multilingual-e5-small");

    // «hello» = 4 و«world» = 5 في الملف، والطرفان 0 و2 من المُعالج اللاحق.
    // المُرمِّز البديل كان يعطي [2, 1, 2, 3]: معرّفات من عدّاد يتصادم مع الرموز الخاصة.
    expect(tokenizer.encode("hello world")).toEqual([0, 4, 5, 2]);
  });

  it("أول معرّف رمز بداية النموذج وآخره رمز نهايته", async () => {
    const { loadTokenizer } = await freshEmbedder();
    const tokenizer = await loadTokenizer("multilingual-e5-small");
    const ids = tokenizer.encode("hello");

    expect(ids[0]).toBe(0);
    expect(ids[ids.length - 1]).toBe(2);
  });

  it("maxLength يقتطع إلى الطول المطلوب بالضبط ولو طال النص", async () => {
    const { loadTokenizer } = await freshEmbedder();
    const tokenizer = await loadTokenizer("multilingual-e5-small");

    const ids = tokenizer.encode("hello world hello world", 4);

    expect(ids).toHaveLength(4);
    expect(ids).toEqual([0, 4, 5, 2]);
  });

  it("نموذج مجهول يرمي خطأ بدل السقوط الصامت على مُرمِّز بديل", async () => {
    const { loadTokenizer } = await freshEmbedder();

    await expect(loadTokenizer("غير-موجود")).rejects.toThrow(/Unknown embedding model/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("كلمتان مختلفتان لا تتصادمان في المعرّفات", async () => {
    const { loadTokenizer } = await freshEmbedder();
    const tokenizer = await loadTokenizer("multilingual-e5-small");

    expect(tokenizer.encode("hello")).not.toEqual(tokenizer.encode("world"));
  });

  it("يحمل ملفَّي المُرمِّز مرة واحدة لكل نموذج", async () => {
    const { loadTokenizer } = await freshEmbedder();
    await loadTokenizer("multilingual-e5-small");
    await loadTokenizer("multilingual-e5-small");

    const urls = mockFetch.mock.calls.map((call) => String(call[0]));
    expect(urls.filter((url) => url.endsWith("tokenizer.json"))).toHaveLength(1);
    expect(urls.filter((url) => url.endsWith("tokenizer_config.json"))).toHaveLength(1);
    // ولا يُنزَّل النموذج نفسه: تحميل المُرمِّز مستقل عن جلسة ONNX
    expect(urls.filter((url) => url.endsWith(".onnx"))).toHaveLength(0);
  });

  it("يُخزَّن المُرمِّز في الكاش فلا يُعاد تنزيله بعد إعادة تحميل الوحدة", async () => {
    const first = await freshEmbedder();
    await first.loadTokenizer("multilingual-e5-small");
    expect(mockFetch).toHaveBeenCalledTimes(2);

    vi.resetModules();
    const second = await import("./embedder");
    const tokenizer = await second.loadTokenizer("multilingual-e5-small");

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(tokenizer.encode("hello world")).toEqual([0, 4, 5, 2]);
  });
});

// ---------------------------------------------------------------------------
// المتجهات الذهبية (ADR 0003) - لا تعمل إلا بوجود ملفَّي النموذج الحقيقيين، لأن
// tokenizer.json حجمه 16.29 ميبيبايت ولا يجوز إضافته إلى المستودع ولا تنزيله في CI.
// التشغيل: SHURA_GOLDEN_TOKENIZER_DIR="<مجلد فيه tokenizer.json وtokenizer_config.json>" \
//          pnpm vitest run src/lib/rag/embedder.spec.ts
// ---------------------------------------------------------------------------

const GOLDEN_DIR = process.env.SHURA_GOLDEN_TOKENIZER_DIR;
/** بصمة الملف الذي ثُبّتت عليه المتجهات: تغيّرها يعني تغيّر فضاء المتجهات. */
const GOLDEN_TOKENIZER_SHA256 = "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39";
const goldenDescribe = GOLDEN_DIR ? describe : describe.skip;

goldenDescribe("المتجهات الذهبية من ملف النموذج الحقيقي (ADR 0003)", () => {
  const assetBytes = (name: string) => {
    const buffer = fs.readFileSync(path.join(GOLDEN_DIR ?? "", name));
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  };

  beforeEach(async () => {
    vi.resetModules();
    const { db } = await import("@/lib/db/db");
    await db.rag_model_blobs.clear();
    mockFetch.mockReset();
    mockFetch.mockImplementation(async (input: unknown) => {
      const name = String(input).split("/").pop() ?? "";
      return { ok: true, status: 200, statusText: "OK", arrayBuffer: async () => assetBytes(name) };
    });
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("«مرحبا بالعالم» تعطي معرّفات ADR 0003", async () => {
    const { loadTokenizer } = await import("./embedder");
    const tokenizer = await loadTokenizer("multilingual-e5-small");

    expect(tokenizer.encode("مرحبا بالعالم")).toEqual([0, 665, 193478, 258, 1705, 77796, 2]);
  });

  it("«hello world» تعطي معرّفات ADR 0003", async () => {
    const { loadTokenizer } = await import("./embedder");
    const tokenizer = await loadTokenizer("multilingual-e5-small");

    expect(tokenizer.encode("hello world")).toEqual([0, 33600, 31, 8999, 2]);
  });

  it("بصمة الملف المثبّتة تطابق الملف المُتحقَّق منه", () => {
    const file = fs.readFileSync(path.join(GOLDEN_DIR ?? "", "tokenizer.json"));

    expect(createHash("sha256").update(file).digest("hex")).toBe(GOLDEN_TOKENIZER_SHA256);
  });
});
