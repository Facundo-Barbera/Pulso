/** Nutrition: meal log, daily targets, diet plans, day adjustments, water and barcode lookups. */

export const MEAL_SLOTS = ["desayuno", "media_manana", "comida", "merienda", "cena", "snack"] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export const MEAL_SOURCES = ["manual", "barcode", "plan", "agent"] as const;
export type MealSource = (typeof MEAL_SOURCES)[number];

/** What macros are counted against: grams, millilitres, or whole servings. Older entries logged drinks as `g`. */
export const QUANTITY_UNITS = ["g", "ml", "serving"] as const;
export type QuantityUnit = (typeof QUANTITY_UNITS)[number];

export const HOUSEHOLD_UNITS = ["taza", "vaso", "lata", "botella", "cucharada", "cucharadita", "unidad", "puño"] as const;
/** Measures people say out loud. Each converts to g or ml with a default size, which an entry can override. */
export type HouseholdUnit = (typeof HOUSEHOLD_UNITS)[number];

/**
 * Default size of one household unit. `unidad` has none: without a size it
 * counts as servings ("2 galletas"), with one as grams ("2 galletas de 11 g").
 */
export const HOUSEHOLD_SIZES: Record<HouseholdUnit, { base: "g" | "ml"; size: number | null }> = {
  taza: { base: "ml", size: 240 },
  vaso: { base: "ml", size: 250 },
  lata: { base: "ml", size: 355 },
  botella: { base: "ml", size: 500 },
  cucharada: { base: "ml", size: 15 },
  cucharadita: { base: "ml", size: 5 },
  unidad: { base: "g", size: null },
  puño: { base: "g", size: 30 },
};

export const MEASURE_UNITS = [...QUANTITY_UNITS, ...HOUSEHOLD_UNITS] as const;
export type MeasureUnit = (typeof MEASURE_UNITS)[number];

/** How much, as the person said it: "2 latas", "1 taza de 300 ml", "30 g". */
export type Measure = {
  amount: number;
  unit: MeasureUnit;
  /** g or ml in one household unit, when not its default (e.g. a 330 ml can). null for g, ml and serving. */
  size: number | null;
};

/** Energy in kcal, everything else in grams. */
export type Macros = { kcal: number; protein: number; carbs: number; fat: number; fiber: number };

/** Caffeine and alcohol in an entry, when the food or drink has them. */
export type Stimulants = {
  /** Caffeine in mg. */
  caffeineMg: number | null;
  /** Pure alcohol in grams. */
  alcoholG: number | null;
};

/**
 * A logged food or drink. Macros are totals for `quantity`, not per 100 g.
 * `quantity` + `unit` are the normalized amount; `measure` is what the person said.
 */
export type MealEntry = Macros & Stimulants & {
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
  /** The amount as said ("2 latas"); null when it was logged straight in g, ml or servings. */
  measure: Measure | null;
};

export type MealInput = Omit<
  MealEntry,
  "id" | "date" | "eatenAt" | "source" | "barcode" | "planItemId" | "offPlan" | "note" | "measure" | "caffeineMg" | "alcoholG"
> & {
  /** Defaults to now. */
  eatenAt?: number;
  /** Defaults to the local day of `eatenAt`. */
  date?: string;
  source?: MealSource;
  barcode?: string | null;
  planItemId?: string | null;
  offPlan?: boolean;
  note?: string | null;
  measure?: Measure | null;
  caffeineMg?: number | null;
  alcoholG?: number | null;
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
  /** Caffeine (mg) and alcohol (g) logged that day; 0 when none. */
  caffeineMg: number;
  alcoholG: number;
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
  /** Daily goal in ml; null means derived (35 ml/kg of body weight kept within 2000–3700 ml, or 2000 ml). */
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
export type FrequentFood = Macros &
  Stimulants & { name: string; quantity: number; unit: QuantityUnit; measure: Measure | null; slot: MealSlot; barcode: string | null; count: number };
