import { describe, expect, it, vi } from "vitest";
import { fetchModelCatalog } from "./modelCatalog";
import { PROVIDERS } from "./registry";

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const catalog = (data: unknown[]) => jsonResponse({ data });

describe("fetchModelCatalog", () => {
  it("يحمّل قائمة مباشرة من موديلات المزود", async () => {
    const models = await fetchModelCatalog("openrouter", {
      fetchImpl: async () => catalog([{ id: "vendor/model-a", name: "Model A", context_length: 128000, pricing: { prompt: "0.000002", completion: "0.00001" } }]),
    });
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe("vendor/model-a");
    expect(models[0].contextLength).toBe(128000);
    expect(models[0].pricing).toEqual({ inputPerMTok: 2, outputPerMTok: 10 });
  });

  it("يقرأ سعر قراءة وكتابة المخبأ حين ينشره المزود", async () => {
    const models = await fetchModelCatalog("openrouter", {
      fetchImpl: async () => catalog([{ id: "m", pricing: { prompt: "0.000001", completion: "0.000002", input_cache_read: "0.0000002", input_cache_write: "0.0000025" } }]),
    });
    expect(models[0].pricing).toEqual({ inputPerMTok: 1, outputPerMTok: 2, cacheReadPerMTok: 0.2, cacheWritePerMTok: 2.5 });
  });

  it("يتجاهل سعرًا غير منتهٍ أو سالبًا بدل تخزين رقم فاسد", async () => {
    const models = await fetchModelCatalog("openrouter", {
      fetchImpl: async () => catalog([
        { id: "bad", pricing: { prompt: "NaN", completion: "-3" } },
        { id: "good", pricing: { prompt: "0.000001", completion: "0.000002" } },
      ]),
    });
    expect(models[0].pricing).toBeNull();
    expect(models[1].pricing).not.toBeNull();
  });

  it("يتجاهل سياقًا غير منتهٍ", async () => {
    const models = await fetchModelCatalog("openrouter", {
      fetchImpl: async () => catalog([{ id: "m", context_length: "unlimited", pricing: { prompt: "0.000001", completion: "0.000002" } }]),
    });
    expect(models[0].contextLength).toBeUndefined();
  });

  it("يتجاهل مدخلات بلا معرّف صالح", async () => {
    const models = await fetchModelCatalog("openrouter", {
      fetchImpl: async () => catalog([{ name: "no id" }, { id: "", name: "empty" }, { id: "ok" }]),
    });
    expect(models.map((m) => m.id)).toEqual(["ok"]);
  });

  it("يرفض استجابة HTTP فاشلة بدل عرض قائمة فارغة", async () => {
    await expect(fetchModelCatalog("openrouter", { fetchImpl: async () => new Response("nope", { status: 503 }) }))
      .rejects.toThrow(/errors\.catalogFetchFailed/);
  });

  it("يرفض مزودًا بلا مصدر مباشر", async () => {
    expect(PROVIDERS.google.modelsSource).toBe("static");
    await expect(fetchModelCatalog("google", { fetchImpl: async () => jsonResponse({}) }))
      .rejects.toThrow(/errors\.catalogNotLive/);
  });

  it("يحترم الإلغاء ولا يعيد نتيجة بعده", async () => {
    const controller = new AbortController();
    const pending = fetchModelCatalog("openrouter", {
      fetchImpl: async (_input, init) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
        return catalog([{ id: "late" }]);
      },
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toThrow();
  });

  it("ينتهي بمهلة حتى لو علّق المزود الطلب", async () => {
    const promise = fetchModelCatalog("openrouter", {
      fetchImpl: () => new Promise<Response>(() => undefined),
      timeoutMs: 10,
    });
    await expect(promise).rejects.toThrow(/errors\.catalogTimeout/);
  });
});

describe("قائمة OpenCode Go المرتبطة بالاستحقاق (T2.8/LV-04)", () => {
  it("يرسل مفتاح المزود حين تكون القائمة مرتبطة بالاستحقاق", async () => {
    let seen: Headers | undefined;
    const models = await fetchModelCatalog("opencodego", {
      apiKey: "sk-test",
      fetchImpl: async (_input, init) => { seen = new Headers(init?.headers); return catalog([{ id: "glm-5.3" }, { id: "kimi-k2.6" }]); },
    });
    expect(seen?.get("Authorization")).toBe("Bearer sk-test");
    expect(models.map((m) => m.id)).toEqual(["glm-5.3", "kimi-k2.6"]);
  });

  it("لا يجلب القائمة المجهولة حين تلزمها مفتاح ولا يوجد مفتاح", async () => {
    const fetchImpl = vi.fn(async () => catalog([{ id: "mimo-v2-pro" }]));
    await expect(fetchModelCatalog("opencodego", { fetchImpl })).rejects.toThrow(/errors\.catalogNeedsKey/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("لا يرسل مفتاحًا إلى قائمة عامة", async () => {
    let seen: Headers | undefined;
    await fetchModelCatalog("openrouter", {
      apiKey: "sk-test",
      fetchImpl: async (_input, init) => { seen = new Headers(init?.headers); return catalog([{ id: "vendor/model-a" }]); },
    });
    expect(seen?.get("Authorization")).toBeNull();
  });
});
