/** Nutrition: meal log, daily targets, diet plans, day adjustments, water and barcode lookups. */

export const MEAL_SLOTS = ["desayuno", "media_manana", "comida", "merienda", "cena", "snack"] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export const MEAL_SOURCES = ["manual", "barcode", "plan", "agent"] as const;
export type MealSource = (typeof MEAL_SOURCES)[number];

/** `g` for grams (ml counts as g), `serving` for units/portions. */
export type QuantityUnit = "g" | "serving";

/** Energy in kcal, everything else in grams. */
export type Macros = { kcal: number; protein: number; carbs: number; fat: number; fiber: number };

/** A logged food. Macros are totals for `quantity`, not per 100 g. */
export type MealEntry = Macros & {
  id: string;
  /** Local calendar day (YYYY-MM-DD) the entry counts toward. */
  date: string;
  /** Epoch ms. */
  eatenAt: number;
  slot: MealSlot;
  name: string;
  quantity: number;
  unit: QuantityUnit;
  source: MealSource;
  barcode: string | null;
  /** The plan item this entry fulfils, when logged from the plan. */
  planItemId: string | null;
  /** True when the person ate it instead of, or on top of, the active plan. */
  offPlan: boolean;
  /** The person's own words for the meal, e.g. "Big Mac y papas medianas". */
  note: string | null;
};

export type MealInput = Omit<MealEntry, "id" | "date" | "eatenAt" | "source" | "barcode" | "planItemId" | "offPlan" | "note"> & {
  /** Defaults to now. */
  eatenAt?: number;
  /** Defaults to the local day of `eatenAt`. */
  date?: string;
  source?: MealSource;
  barcode?: string | null;
  planItemId?: string | null;
  offPlan?: boolean;
  note?: string | null;
};

export type NutritionTargets = Macros & { updatedAt: number };

export type DailySummary = {
  date: string;
  totals: Macros;
  /** null until targets are set. */
  targets: NutritionTargets | null;
  /** targets − totals (negative = over). null without targets. */
  remaining: Macros | null;
  bySlot: Partial<Record<MealSlot, Macros>>;
  entries: number;
};

export type PlanItem = Macros & { id: string; name: string; quantity: number; unit: QuantityUnit };
export type PlanMeal = { slot: MealSlot; name: string | null; items: PlanItem[] };
export type PlanDay = { label: string; meals: PlanMeal[] };

/** A diet plan. Days repeat in order starting on `startsOn` (one day = same every day; seven = a week). */
export type DietPlan = {
  id: string;
  name: string;
  notes: string | null;
  startsOn: string;
  active: boolean;
  createdAt: number;
  days: PlanDay[];
};

/** Plan items and meals before ids are assigned. */
export type DietPlanInput = {
  name: string;
  notes?: string | null;
  startsOn?: string;
  activate?: boolean;
  days: { label: string; meals: { slot: MealSlot; name?: string | null; items: Omit<PlanItem, "id">[] }[] }[];
};

/** How an adjusted meal differs from the plan: portions scaled, or replaced by the Coach. */
export type AdjustedMeal = PlanMeal & { change: "scaled" | "swapped" | "same" };

/**
 * The Coach's rewrite of what is left of one day, on top of the plan (which stays
 * untouched). Scaled items keep their plan item id; swapped ones get new ids.
 */
export type DayAdjustment = {
  date: string;
  planId: string;
  dayIndex: number;
  /** Portion factor applied to the planned meals that were not swapped. */
  factor: number;
  /** The meals still ahead that day, as they should now be eaten. */
  meals: AdjustedMeal[];
  /** Eaten when the adjustment was made. */
  eaten: Macros;
  targets: Macros;
  /** Where the day ends if the adjusted meals are eaten. */
  projected: Macros;
  /** One Spanish line, e.g. "Merienda y cena al 80 %. Cierras el día en 2.180 de 2.200 kcal." */
  summary: string;
  /** The Coach's reason, in Spanish. */
  note: string | null;
  createdAt: number;
};

/** The active plan as seen on one date: which day applies, which items are already logged, and the day's adjustment. */
export type PlanForDay = { plan: DietPlan; dayIndex: number; day: PlanDay; eatenItemIds: string[]; adjustment: DayAdjustment | null };

/** A packaged food from Open Food Facts. Macros per 100 g. */
export type FoodProduct = {
  barcode: string;
  name: string;
  brand: string | null;
  per100g: Macros;
  /** Grams in one serving, when the label says. */
  servingGrams: number | null;
  imageUrl: string | null;
};

export const WATER_UNITS = ["ml", "vaso", "botella"] as const;
/** How the person counts water: millilitres, glasses or bottles of their own sizes. */
export type WaterUnit = (typeof WATER_UNITS)[number];

export type WaterSettings = {
  /** Daily goal in ml; null means derived (35 ml/kg of body weight, or 2000 ml). */
  goalMl: number | null;
  unit: WaterUnit;
  glassMl: number;
  bottleMl: number;
};

export type WaterEntry = {
  id: string;
  /** Local calendar day (YYYY-MM-DD). */
  date: string;
  /** Epoch ms. */
  loggedAt: number;
  amountMl: number;
  source: "manual" | "agent";
};

export type WaterDay = {
  date: string;
  totalMl: number;
  goalMl: number;
  /** Where goalMl came from. */
  goalSource: "custom" | "weight" | "default";
  /** Oldest first. */
  entries: WaterEntry[];
  settings: WaterSettings;
};

/** Everything the Dieta tab draws for one day, in one request. */
export type NutritionDay = { summary: DailySummary; meals: MealEntry[]; plan: PlanForDay | null; water: WaterDay };

/** A food the person logs often, for quick add. Macros are per one logged `quantity`. */
export type FrequentFood = Macros & { name: string; quantity: number; unit: QuantityUnit; slot: MealSlot; barcode: string | null; count: number };
