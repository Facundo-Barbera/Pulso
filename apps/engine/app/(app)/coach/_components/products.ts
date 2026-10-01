import { MAX_AGENT_PRODUCTS, type AgentProduct, type FoodProduct } from "@pulso/contract";
import { fmtNumber } from "../../../_ui/format";

export const MAX_PRODUCTS = MAX_AGENT_PRODUCTS;

/** A product added to the message being written: `looking` until Open Food Facts answers, `offline` when it could not be asked. */
export type DraftProduct = AgentProduct & { looking: boolean; offline: boolean };

/** The digits of an EAN/UPC (spaces and dashes dropped), or null when it can't be one. Same rule as the Mac's. */
export function normalizeBarcode(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  return /^\d{8,14}$/.test(digits) ? digits : null;
}

/** "588 kcal / 100 g", or "/ 100 ml" for a drink. */
export const per100 = (product: FoodProduct) => ({ kcal: `${fmtNumber(product.per100g.kcal)} kcal`, base: `/ 100 ${product.liquid ? "ml" : "g"}` });

export type Lookup = { product: FoodProduct | null; offline: boolean } | { error: string };

/** The product behind a code. A bad code is an error; Open Food Facts being unreachable still lets the code go with the message. */
export async function lookupProduct(code: string): Promise<Lookup> {
  const response = await fetch(`/api/web/dieta/barcode/${encodeURIComponent(code)}`, { cache: "no-store" }).catch(() => null);
  if (!response) return { product: null, offline: true };
  const body = (await response.json().catch(() => null)) as { product?: FoodProduct | null; message?: string } | null;
  if (response.ok) return { product: body?.product ?? null, offline: false };
  if (response.status === 400) return { error: body?.message ?? "El código debe tener de 8 a 14 dígitos." };
  if (response.status === 401) return { error: "Este navegador ya no está emparejado con Pulso." };
  return { product: null, offline: true };
}
