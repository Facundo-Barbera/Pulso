import { expect, test } from "bun:test";
import { db } from "../db";
import { lookupBarcode, normalizeBarcode, parseAmount, parseOffProduct } from "./barcode";

const off = (nutriments: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  status: 1,
  product: { product_name: "Yogur natural", brands: "Danone, Danone España", serving_quantity: "125", image_front_small_url: "https://img/x.jpg", nutriments, ...extra },
});

test("normalizeBarcode accepts EAN/UPC lengths and strips spaces", () => {
  expect(normalizeBarcode("8410 0000 1234 5")).toBe("8410000012345");
  expect(normalizeBarcode("1234567")).toBeUndefined();
  expect(normalizeBarcode("84100000abc")).toBeUndefined();
});

test("parseOffProduct maps per-100 g nutriments and prefers the Spanish name", () => {
  const p = parseOffProduct("8410000012345", off({ "energy-kcal_100g": 61.4, proteins_100g: 3.5, carbohydrates_100g: 4.66, fat_100g: 3.1 }, { product_name_es: "Yogur" }));
  expect(p).toEqual({
    barcode: "8410000012345",
    name: "Yogur",
    brand: "Danone",
    per100g: { kcal: 61, protein: 3.5, carbs: 4.7, fat: 3.1, fiber: 0 },
    servingGrams: 125,
    imageUrl: "https://img/x.jpg",
    liquid: false,
    packageSize: null,
    packageKind: null,
  });
});

test("parseAmount reads label amounts in g or ml, one unit of a pack", () => {
  expect(parseAmount("1,5 L")).toEqual({ amount: 1500, liquid: true });
  expect(parseAmount("33cl")).toEqual({ amount: 330, liquid: true });
  expect(parseAmount("6 x 330 ml")).toEqual({ amount: 330, liquid: true });
  expect(parseAmount("e 200 g")).toEqual({ amount: 200, liquid: false });
  expect(parseAmount("1 lata")).toBeUndefined();
  expect(parseAmount(null)).toBeUndefined();
});

test("drinks are told apart by the label's unit, else by the beverages category", () => {
  const energy = { "energy-kcal_100g": 42 };
  const coke = parseOffProduct("1", off(energy, { quantity: "600 ml", product_quantity: "600", product_quantity_unit: "ml", serving_quantity: undefined, packaging_tags: ["en:plastic-bottle"] }));
  expect(coke).toMatchObject({ liquid: true, packageSize: 600, packageKind: "botella", servingGrams: null });
  const can = parseOffProduct("1", off(energy, { quantity: "6 x 355 ml", product_quantity: 2130, serving_size: "355 ml", serving_quantity: undefined, packaging_tags: ["en:can"] }));
  expect(can).toMatchObject({ liquid: true, packageSize: 355, packageKind: "lata", servingGrams: 355 });
  expect(parseOffProduct("1", off(energy, { categories_tags: ["en:beverages"] }))?.liquid).toBe(true);
  // Cocoa powder is filed under beverages, but its label says grams.
  expect(parseOffProduct("1", off(energy, { quantity: "400 g", categories_tags: ["en:beverages"] }))).toMatchObject({ liquid: false, packageSize: 400 });
});

test("parseOffProduct falls back to kJ and rejects products without energy", () => {
  expect(parseOffProduct("1", off({ energy_100g: 418.4 }))?.per100g.kcal).toBe(100);
  expect(parseOffProduct("1", off({ proteins_100g: 3 }))).toBeNull();
  expect(parseOffProduct("1", { status: 0, status_verbose: "product not found" })).toBeNull();
});

test("lookupBarcode caches hits and misses, and does not cache failures", async () => {
  let calls = 0;
  const respond = (status: number, body: unknown) => (async () => {
    calls++;
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;

  const hit = respond(200, off({ "energy-kcal_100g": 50 }));
  expect((await lookupBarcode("00000001", hit, 1_000))?.per100g.kcal).toBe(50);
  expect((await lookupBarcode("00000001", hit, 2_000))?.name).toBe("Yogur natural");
  expect(calls).toBe(1);

  const miss = respond(404, { status: 0 });
  expect(await lookupBarcode("00000002", miss, 1_000)).toBeNull();
  expect(await lookupBarcode("00000002", miss, 2_000)).toBeNull();
  expect(calls).toBe(2);
  // A miss is retried after a day.
  await lookupBarcode("00000002", miss, 1_000 + 86_400_001);
  expect(calls).toBe(3);

  await expect(lookupBarcode("00000003", respond(503, {}), 1_000)).rejects.toThrow("503");
  await lookupBarcode("00000003", hit, 2_000);
  expect(calls).toBe(5);

  // A product cached before drinks were told apart is fetched again.
  const old = { barcode: "00000004", name: "Viejo", brand: null, per100g: { kcal: 1, protein: 0, carbs: 0, fat: 0, fiber: 0 }, servingGrams: null, imageUrl: null };
  db().query("INSERT OR REPLACE INTO food_barcode_cache (barcode, product_json, fetched_at) VALUES (?, ?, ?)").run("00000004", JSON.stringify(old), 1_000);
  expect((await lookupBarcode("00000004", hit, 2_000))?.liquid).toBe(false);
  expect(calls).toBe(6);
});
