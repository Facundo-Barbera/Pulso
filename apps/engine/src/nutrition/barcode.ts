/**
 * Packaged food lookup through Open Food Facts, cached in SQLite. Found
 * products are kept for 30 days, misses for one day (products get added).
 */
import type { FoodProduct, Macros } from "@pulso/contract";
import { db } from "../db";

const FOUND_TTL = 30 * 86_400_000;
const MISS_TTL = 86_400_000;
const OFF_FIELDS = "product_name,product_name_es,generic_name,brands,nutriments,serving_quantity,image_front_small_url";

/** EAN-8, UPC-A, EAN-13 or GTIN-14, digits only. Undefined when it isn't one. */
export function normalizeBarcode(raw: string): string | undefined {
  const digits = raw.replace(/[\s-]/g, "");
  return /^\d{8,14}$/.test(digits) ? digits : undefined;
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number.parseFloat(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : undefined;
};
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Maps an Open Food Facts v2 product response to a FoodProduct. Null when not found or without energy. */
export function parseOffProduct(barcode: string, body: unknown): FoodProduct | null {
  const product = (body as { status?: number; product?: Record<string, unknown> })?.product;
  if (!product || (body as { status?: number }).status === 0) return null;
  const n = (product.nutriments ?? {}) as Record<string, unknown>;
  const kj = num(n["energy_100g"]);
  const kcal = num(n["energy-kcal_100g"]) ?? (kj === undefined ? undefined : kj / 4.184);
  if (kcal === undefined) return null;
  const per100g: Macros = {
    kcal: Math.round(kcal),
    protein: r1(num(n["proteins_100g"]) ?? 0),
    carbs: r1(num(n["carbohydrates_100g"]) ?? 0),
    fat: r1(num(n["fat_100g"]) ?? 0),
    fiber: r1(num(n["fiber_100g"]) ?? 0),
  };
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    barcode,
    name: text(product.product_name_es) ?? text(product.product_name) ?? text(product.generic_name) ?? "Producto sin nombre",
    brand: text(product.brands)?.split(",")[0]?.trim() ?? null,
    per100g,
    servingGrams: num(product.serving_quantity) ?? null,
    imageUrl: text(product.image_front_small_url),
  };
}

type CacheRow = { product_json: string | null; fetched_at: number };

/**
 * Cached lookup. Null when Open Food Facts doesn't know the code; throws
 * when it can't be reached (so a network blip isn't cached as a miss).
 */
export async function lookupBarcode(barcode: string, fetcher: typeof fetch = fetch, now = Date.now()): Promise<FoodProduct | null> {
  const cached = db().query<CacheRow, [string]>("SELECT product_json, fetched_at FROM food_barcode_cache WHERE barcode = ?").get(barcode);
  if (cached && now - cached.fetched_at < (cached.product_json ? FOUND_TTL : MISS_TTL)) {
    return cached.product_json ? (JSON.parse(cached.product_json) as FoodProduct) : null;
  }
  const url = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=${OFF_FIELDS}`;
  const response = await fetcher(url, { headers: { "user-agent": "Pulso/0.1 (personal nutrition app)" }, signal: AbortSignal.timeout(8000) });
  if (!response.ok && response.status !== 404) throw new Error(`Open Food Facts responded ${response.status}`);
  const product = response.status === 404 ? null : parseOffProduct(barcode, await response.json());
  db()
    .query("INSERT OR REPLACE INTO food_barcode_cache (barcode, product_json, fetched_at) VALUES (?, ?, ?)")
    .run(barcode, product && JSON.stringify(product), now);
  return product;
}
