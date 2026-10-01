/** Shopping list: what to buy for the coming days of the active diet plan, plus the person's own items. */

/** Supermarket aisles, in the order the list shows them. */
export const SHOPPING_CATEGORIES = [
  "frutas_verduras",
  "carnes_pescados",
  "lacteos_huevos",
  "panaderia_cereales",
  "despensa",
  "bebidas",
  "congelados",
  "otros",
] as const;
export type ShoppingCategory = (typeof SHOPPING_CATEGORIES)[number];

export const SHOPPING_CATEGORY_LABELS: Record<ShoppingCategory, string> = {
  frutas_verduras: "Frutas y verduras",
  carnes_pescados: "Carnes y pescados",
  lacteos_huevos: "Lácteos y huevos",
  panaderia_cereales: "Panadería y cereales",
  despensa: "Despensa",
  bebidas: "Bebidas",
  congelados: "Congelados",
  otros: "Otros",
};

/** How many days a list can cover. The phone offers 3, 7 and 14. */
export const SHOPPING_MAX_DAYS = 14;

export type ShoppingItem = {
  id: string;
  name: string;
  /** What to buy, as shown: "1,4 kg", "2 L", "12", "3 latas". Null for a manual item without one. */
  amount: string | null;
  /** What the plan needs before rounding to a buyable amount, in `unit`. Null for manual items. */
  quantity: number | null;
  /** `g`, `ml`, `ud` (units/servings) or the plan's own unit when it can't be converted (e.g. `taza`). */
  unit: string | null;
  category: ShoppingCategory;
  source: "plan" | "manual";
  /** Bought. */
  checked: boolean;
  /** "Ya tengo": already at home, not needed this time. Not counted in the progress. */
  pantry: boolean;
  note: string | null;
  updatedAt: number;
};

export type ShoppingList = {
  /** The range the plan items cover (local dates, inclusive). Null until generated. */
  from: string | null;
  to: string | null;
  days: number | null;
  planId: string | null;
  planName: string | null;
  generatedAt: number | null;
  /** True when there is an active plan to generate from. */
  hasPlan: boolean;
  /** True when the active plan is not the one the list was generated from. */
  stale: boolean;
  /** Sorted by aisle, then name. */
  items: ShoppingItem[];
  /** Bought items, and items to buy («Ya tengo» excluded). */
  done: number;
  total: number;
  /** The items still to buy as plain text, grouped by aisle, to send to someone. */
  text: string;
};

export type ShoppingGenerateInput = { days?: number; from?: string };

export type ShoppingItemInput = { name: string; amount?: string | null; category?: ShoppingCategory; note?: string | null };

export type ShoppingItemPatch = Partial<Pick<ShoppingItem, "name" | "amount" | "category" | "checked" | "pantry" | "note">>;
