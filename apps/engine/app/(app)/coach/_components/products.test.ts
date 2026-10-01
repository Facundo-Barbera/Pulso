import { afterEach, expect, test } from "bun:test";
import type { FoodProduct } from "@pulso/contract";
import { lookupProduct, normalizeBarcode, per100 } from "./products";

const product: FoodProduct = {
  barcode: "8410000000000",
  name: "Crema de cacahuete",
  brand: "Marca",
  per100g: { kcal: 588, protein: 25, carbs: 16, fat: 50, fiber: 6 },
  servingGrams: 15,
  imageUrl: null,
  liquid: false,
  packageSize: 350,
  packageKind: null,
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const answer = (status: number, body: unknown) => {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
};

test("a barcode is 8 to 14 digits; spaces and dashes are dropped", () => {
  expect(normalizeBarcode(" 841 0000-000000 ")).toBe("8410000000000");
  expect(normalizeBarcode("1234567")).toBeNull();
  expect(normalizeBarcode("123456789012345")).toBeNull();
  expect(normalizeBarcode("84100000a0000")).toBeNull();
});

test("energy reads per 100 g, or per 100 ml for a drink", () => {
  expect(per100(product)).toEqual({ kcal: "588 kcal", base: "/ 100 g" });
  expect(per100({ ...product, liquid: true }).base).toBe("/ 100 ml");
});

test("lookup: found, unknown, bad code and Open Food Facts down", async () => {
  answer(200, { product });
  expect(await lookupProduct(product.barcode)).toEqual({ product, offline: false });
  answer(200, { product: null });
  expect(await lookupProduct(product.barcode)).toEqual({ product: null, offline: false });
  answer(400, { message: "El código debe tener de 8 a 14 dígitos." });
  expect(await lookupProduct("1")).toEqual({ error: "El código debe tener de 8 a 14 dígitos." });
  answer(502, { message: "No se pudo consultar Open Food Facts." });
  expect(await lookupProduct(product.barcode)).toEqual({ product: null, offline: true });
  globalThis.fetch = (async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
  expect(await lookupProduct(product.barcode)).toEqual({ product: null, offline: true });
});
