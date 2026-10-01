/**
 * The dated diet: the active plan laid out as concrete slots (date × meal),
 * recipes and prep batches that fill them, the pantry, and the revisions every
 * local change leaves (each can be undone). See apps/engine/src/nutrition/DIET.md.
 */
import type { DayAdjustment, Macros, MealSlot, MeasureUnit, PlanItem } from "./nutrition";
import type { ShoppingCategory } from "./shopping";

/**
 * What fills a slot: the plan's own item list, a portion of a recipe cooked
 * that day, a portion of a prep batch cooked earlier, or a budget for eating out.
 */
export const SLOT_KINDS = ["items", "recipe", "prep", "eat_out"] as const;
export type SlotKind = (typeof SLOT_KINDS)[number];

/** `eaten` is derived from linked log entries; the other three are stored. */
export const SLOT_STATUSES = ["planned", "eaten", "replaced", "skipped"] as const;
export type SlotStatus = (typeof SLOT_STATUSES)[number];

/** One meal on one date. */
export type PlanSlot = {
  id: string;
  planId: string;
  date: string;
  slot: MealSlot;
  kind: SlotKind;
  /** Dish name ("Pasta boloñesa"), or null for a plain item list. */
  name: string | null;
  recipeId: string | null;
  prepId: string | null;
  /** Portions of the recipe or batch (recipe and prep kinds). */
  portions: number | null;
  /**
   * What to eat as planned. Recipe and prep slots carry one item (the dish, in
   * servings); an eat-out slot carries its budget as one item.
   */
  items: PlanItem[];
  /** The day's adjustment for this meal (scaled or swapped portions), when the Coach rebalanced the day. */
  adjusted: PlanItem[] | null;
  /** Totals of what should be eaten now: `adjusted` when present, else `items`. kcal and grams. */
  macros: Macros;
  status: SlotStatus;
  /** Log entries linked to this slot (eaten as planned, or eaten instead). */
  entryIds: string[];
  /** What was eaten instead, when replaced (entry names). */
  replacedBy: string | null;
  /** What was actually eaten for this meal (the entries tied to it), when anything was: Planeado → Real. */
  real: RealMeal | null;
  /** Still pending well after its time (or on a past day) with nothing logged: «sin registrar», a soft state, not a skip. */
  missed: boolean;
  /** Minutes of cooking that day: the recipe's prep time; 0 for a batch portion or eating out; null when unknown. */
  cookMinutes: number | null;
  note: string | null;
};

/** The entries tied to a meal, as one meal: "Tortitas de carne de res, queso amarillo y arroz blanco · 965 kcal". */
export type RealMeal = {
  /** Entry names in one line, or the person's own words when they gave them. */
  label: string;
  entryIds: string[];
  /** Totals of those entries: kcal and grams. */
  macros: Macros;
  /** When the first of them was eaten, epoch ms. */
  eatenAt: number;
  /** True when it is exactly what the plan had (its items, ticked or logged as planned). */
  asPlanned: boolean;
};

export type DietDay = {
  date: string;
  /** The plan day's label from the rotation ("Lunes", "Día de entreno"). */
  label: string;
  slots: PlanSlot[];
  /** What the day's planned slots add up to now (eaten + still planned). */
  planned: Macros;
  /** Everything the plan had for the day as written (every slot, whatever happened to it): the «Planeado» total. */
  asPlanned: Macros;
  /** Everything logged that day, meals and extras: the «Real» total. */
  real: Macros;
  /** Entries logged that day that no meal holds (snacks, drinks): the day's «Extras», oldest first. */
  extraIds: string[];
  /** kcal moved onto this day by spreading a deviation (negative = lighter day). */
  shiftKcal: number;
  /** The day's kcal goal: targets (or the plan day's total) plus the shift. */
  goalKcal: number;
  adjustment: DayAdjustment | null;
};

export type RecipeIngredient = Macros & {
  name: string;
  quantity: number;
  /** g, ml, serving or a household unit (lata, taza…), as in meal measures. */
  unit: MeasureUnit;
};

export type Recipe = {
  id: string;
  name: string;
  /** Portions the ingredients make. */
  servings: number;
  prepMinutes: number;
  /** Worth cooking in a batch for several days (keeps well). */
  batch: boolean;
  /** For the whole recipe; macros are totals for each amount. */
  ingredients: RecipeIngredient[];
  /** One portion. */
  perServing: Macros;
  steps: string | null;
  /** The recipe this one was derived from (an ingredient swapped). */
  variantOf: string | null;
  createdAt: number;
};

export type RecipeInput = {
  name: string;
  servings: number;
  prepMinutes: number;
  batch?: boolean;
  ingredients: RecipeIngredient[];
  steps?: string | null;
};

export const PREP_STATUSES = ["planned", "cooked", "discarded"] as const;
export type PrepStatus = (typeof PREP_STATUSES)[number];

/** A recipe cooked on one date that yields several portions, assigned to slots. */
export type PrepBatch = {
  id: string;
  planId: string;
  recipeId: string;
  recipeName: string;
  cookDate: string;
  portions: number;
  status: PrepStatus;
  cookedAt: number | null;
  /** Slots holding a portion (skipped or replaced ones excluded). */
  slotIds: string[];
  /** Portions already eaten. */
  eaten: number;
  /** Portions not assigned to any slot: free to use as leftovers. */
  leftover: number;
};

/** The plan over a range of dates: what the Dieta UIs draw. */
export type DietHorizon = {
  planId: string;
  planName: string;
  from: string;
  to: string;
  /** The plan's horizon length in days (7 or 14 typical). */
  horizonDays: number;
  days: DietDay[];
  preps: PrepBatch[];
  /** The latest change that can still be undone. */
  lastRevision: PlanRevision | null;
};

export type PlanRevision = {
  id: string;
  planId: string;
  /** The operation: log (a meal tied to its slot), skip, replace, ate_out, place, rebalance, spread, ingredient_unavailable, no_time_to_cook, move, swap_days, fill, schedule_prep, prep_cooked, use_leftover. */
  op: string;
  /** What changed, in Spanish: "Cambié salmón por atún en 2 comidas (mar, jue)." */
  summary: string;
  dates: string[];
  createdAt: number;
  undoneAt: number | null;
};

/** How a deviation was compensated: on the same day, spread over the next days, or not at all. */
export type Compensation = {
  mode: "none" | "day" | "spread";
  /** Eaten minus planned, kcal (positive = ate more). */
  deviationKcal: number;
  /** How much of it the change makes up for. */
  absorbedKcal: number;
  /** Left as is: a day never moves more than the bound. */
  unabsorbedKcal: number;
  /** Per-day kcal shifts when spread. */
  days: { date: string; shiftKcal: number }[];
  summary: string;
};

/** What every plan change returns. */
export type PlanChange = {
  revision: PlanRevision;
  summary: string;
  /** The slots as they are now, for the dates the change touched. */
  slots: PlanSlot[];
  compensation: Compensation | null;
  /** True when the shopping list was rebuilt to follow the change. */
  shoppingRefreshed: boolean;
};

/** A plan change on the wire: `op` plus its fields (see the engine's plan-inputs.ts for each). */
export type PlanOpInput = { op: string } & Record<string, unknown>;

export type PantryItem = {
  id: string;
  name: string;
  /** Amount in `unit` (g, ml, ud or the unit it is counted in); null = "some", enough for any need. */
  quantity: number | null;
  unit: string | null;
  /** As shown: "1,4 kg", "6". */
  amount: string | null;
  category: ShoppingCategory;
  /** list: ticked or «Ya tengo» on the shopping list; manual: added by hand or by the Coach. */
  source: "list" | "manual";
  /** The shopping item it came from, while that item is still on the list. */
  shoppingItemId: string | null;
  boughtOn: string | null;
  expiresOn: string | null;
  updatedAt: number;
};

export type PantryInput = { name: string; quantity?: number | null; unit?: string | null; expiresOn?: string | null };
