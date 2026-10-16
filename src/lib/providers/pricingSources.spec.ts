import { describe, expect, it } from "vitest";
import { PROVIDERS } from "./registry";
import { STATIC_PRICE_SOURCES } from "./pricingSources";

// [T7.6/Q7] Guards the rule that a price shown to the user is never invented: every
// non-null registry price must have a cited, matching source, and no source is orphaned.
const pricedModels = () =>
  Object.entries(PROVIDERS).flatMap(([providerId, provider]) =>
    provider.staticModels.flatMap((model) =>
      model.pricing ? [{ key: providerId + "/" + model.id, pricing: model.pricing }] : [],
    ),
  );

describe("static price provenance (T7.6/Q7)", () => {
  it("كل سعر معروض له مصدر منشور مطابق", () => {
    const priced = pricedModels();
    expect(priced.length).toBeGreaterThan(0);
    for (const { key, pricing } of priced) {
      const source = STATIC_PRICE_SOURCES[key];
      expect(source, "لا مصدر للسعر المعروض: " + key).toBeDefined();
      expect(source.inputPerMTok, key).toBe(pricing.inputPerMTok);
      expect(source.outputPerMTok, key).toBe(pricing.outputPerMTok);
    }
  });

  it("لا مصدر يتيم بلا موديل مسعّر", () => {
    const keys = new Set(pricedModels().map((entry) => entry.key));
    for (const key of Object.keys(STATIC_PRICE_SOURCES)) expect(keys.has(key), key).toBe(true);
  });

  it("كل مصدر رابط https مؤرَّخ", () => {
    for (const [key, source] of Object.entries(STATIC_PRICE_SOURCES)) {
      expect(source.url, key).toMatch(/^https:\/\//);
      expect(Number.isNaN(Date.parse(source.asOf)), key).toBe(false);
    }
  });

  it("مزودون بلا نشرة قراءة يبقون بلا سعر (null) لا مُختلقًا", () => {
    for (const providerId of ["minimax", "opencodego"] as const) {
      for (const model of PROVIDERS[providerId].staticModels) {
        expect(model.pricing, providerId + "/" + model.id).toBeNull();
      }
    }
  });
});
