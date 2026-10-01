/**
 * A scanned product eaten off-plan uses up its row in the pantry, so the
 * Coach can say how much is left ("te queda ~85 %"). Planned meals already use
 * the pantry up through reconcile.ts; this is for everything else.
 */
import type { FoodProduct, MealEntry, PantryItem } from "@pulso/contract";
import { nameKey } from "../shopping/aggregate";
import { listPantry, removePantryItems, updatePantryItem } from "../shopping/pantry";

export type PantryUse = {
  name: string;
  /** What is left, in the row's unit; null when the row never had an amount ("tengo crema de cacahuate"). */
  left: number | null;
  unit: string | null;
  /** Share of one package left, 0–100, when it can be told. */
  leftPct: number | null;
};

const tokens = (name: string) => new Set(nameKey(name).split(" ").filter(Boolean));

/** The pantry row this food is: every word of the row's name is in the food's. The most specific wins. */
export function pantryRowFor(name: string, items: PantryItem[] = listPantry()): PantryItem | undefined {
  const food = tokens(name);
  let best: { item: PantryItem; size: number } | undefined;
  for (const item of items) {
    const own = tokens(item.name);
    if (!own.size || ![...own].every((t) => food.has(t))) continue;
    if (!best || own.size > best.size) best = { item, size: own.size };
  }
  return best?.item;
}

/**
 * Takes `quantity` (g or ml) of a product out of its pantry row. Rows in g or
 * ml lose that much; rows counted in packages ("1 bote") lose the share of
 * one package. Undefined when the product isn't in the pantry.
 */
export function usePantry(name: string, quantity: number, packageSize: number | null): PantryUse | undefined {
  const row = pantryRowFor(name);
  if (!row) return undefined;
  if (row.quantity === null) return { name: row.name, left: null, unit: row.unit, leftPct: null };
  const byWeight = row.unit === "g" || row.unit === "ml";
  if (!byWeight && !packageSize) return { name: row.name, left: row.quantity, unit: row.unit, leftPct: null };
  const used = byWeight ? quantity : quantity / packageSize!;
  const left = Math.max(0, Math.round((row.quantity - used) * 100) / 100);
  if (left <= 0 && row.shoppingItemId === null) removePantryItems([row.id]);
  else updatePantryItem(row.id, { quantity: left });
  // A share only reads well within one package: "te queda ~85 %", not "~240 %".
  const share = byWeight ? (packageSize ? left / packageSize : null) : left;
  return { name: row.name, left, unit: row.unit, leftPct: share !== null && share <= 1.001 ? Math.round(share * 100) : null };
}

/**
 * The pantry after a log: each scanned entry that wasn't eaten as planned
 * uses its product up. `sizes` are package sizes by barcode.
 */
export function usePantryFor(entries: MealEntry[], sizes: Map<string, number | null> = new Map()): PantryUse[] {
  const out: PantryUse[] = [];
  for (const e of entries) {
    const planned = e.slotId !== null && !e.offPlan;
    if (!e.barcode || planned || (e.unit !== "g" && e.unit !== "ml")) continue;
    const use = usePantry(e.name, e.quantity, sizes.get(e.barcode) ?? null);
    if (use) out.push(use);
  }
  return out;
}

/** A scanned product logged from the phone or the web: uses it up from the pantry when it is there. */
export async function usePantryForScan(entry: MealEntry, lookup: (code: string) => Promise<FoodProduct | null>): Promise<PantryUse[]> {
  if (!entry.barcode || !pantryRowFor(entry.name)) return [];
  const size = (await lookup(entry.barcode).catch(() => null))?.packageSize ?? null;
  return usePantryFor([entry], new Map([[entry.barcode, size]]));
}
