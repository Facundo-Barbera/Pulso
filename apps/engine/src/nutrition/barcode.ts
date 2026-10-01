/**
 * Packaged food lookup through Open Food Facts, cached in SQLite. Found
 * products are kept for 30 days, misses for one day (products get added).
 */
import type { FoodProduct, Macros } from "@pulso/contract";
import { db } from "../db";

const FOUND_TTL = 30 * 86_400_000;
const MISS_TTL = 86_400_000;
const OFF_FIELDS = [
  "product_name,product_name_es,generic_name,brands,nutriments,serving_quantity,serving_size,image_front_small_url",
  "quantity,product_quantity,product_quantity_unit,categories_tags,packaging_tags",
].join(",");

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

const PER_UNIT: Record<string, { factor: number; liquid: boolean }> = {
  ml: { factor: 1, liquid: true },
  cl: { factor: 10, liquid: true },
  dl: { factor: 100, liquid: true },
  l: { factor: 1000, liquid: true },
  g: { factor: 1, liquid: false },
  gr: { factor: 1, liquid: false },
  kg: { factor: 1000, liquid: false },
};

/** A label amount in g or ml: "1,5 L" → 1500 ml, "33cl" → 330 ml, "6 x 330 ml" → 330 ml (one unit of the pack). */
export function parseAmount(raw: unknown): { amount: number; liquid: boolean } | undefined {
  if (typeof raw !== "string") return undefined;
  const match = raw.toLowerCase().replace(/(\d),(\d)/g, "$1.$2").match(/(\d+(?:\.\d+)?)\s*(ml|cl|dl|l|kg|gr|g)\b/);
  const unit = match && PER_UNIT[match[2] as string];
  if (!match || !unit) return undefined;
  const amount = Math.round(Number.parseFloat(match[1] as string) * unit.factor);
  return amount > 0 ? { amount, liquid: unit.liquid } : undefined;
}

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
  const tags = (v: unknown) => (Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : []);

  // What the label prints decides; the beverages category only when it prints no unit.
  const packageUnit = text(product.product_quantity_unit)?.toLowerCase();
  const pack = parseAmount(product.quantity);
  const serving = parseAmount(product.serving_size);
  const liquid = packageUnit
    ? PER_UNIT[packageUnit]?.liquid ?? false
    : (pack ?? serving)?.liquid ?? tags(product.categories_tags).includes("en:beverages");
  const packaging = tags(product.packaging_tags).join(" ");
  return {
    barcode,
    name: text(product.product_name_es) ?? text(product.product_name) ?? text(product.generic_name) ?? "Producto sin nombre",
    brand: text(product.brands)?.split(",")[0]?.trim() ?? null,
    per100g,
    servingGrams: num(product.serving_quantity) || serving?.amount || null,
    imageUrl: text(product.image_front_small_url),
    liquid,
    packageSize: pack?.amount ?? (num(product.product_quantity) || null),
    packageKind: /\bcan\b|lata/.test(packaging) ? "lata" : /bottle|botella/.test(packaging) ? "botella" : null,
  };
}

type CacheRow = { product_json: string | null; fetched_at: number };

/**
 * Cached lookup. Null when Open Food Facts doesn't know the code; throws
 * when it can't be reached (so a network blip isn't cached as a miss).
 */
export async function lookupBarcode(barcode: string, fetcher: typeof fetch = fetch, now = Date.now()): Promise<FoodProduct | null> {
  const cached = db().query<CacheRow, [string]>("SELECT product_json, fetched_at FROM food_barcode_cache WHERE barcode = ?").get(barcode);
  const hit = cached?.product_json ? (JSON.parse(cached.product_json) as FoodProduct) : null;
  // Products cached before drinks were told apart lack `liquid`; fetch those again.
  const current = !hit || "liquid" in hit;
  if (cached && current && now - cached.fetched_at < (hit ? FOUND_TTL : MISS_TTL)) return hit;
  const url = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=${OFF_FIELDS}`;
  const response = await fetcher(url, { headers: { "user-agent": "Pulso/0.1 (personal nutrition app)" }, signal: AbortSignal.timeout(8000) });
  if (!response.ok && response.status !== 404) throw new Error(`Open Food Facts responded ${response.status}`);
  const product = response.status === 404 ? null : parseOffProduct(barcode, await response.json());
  db()
    .query("INSERT OR REPLACE INTO food_barcode_cache (barcode, product_json, fetched_at) VALUES (?, ?, ?)")
    .run(barcode, product && JSON.stringify(product), now);
  return product;
}
