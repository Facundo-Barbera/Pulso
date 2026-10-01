/** Nutrition: meal log, daily targets, diet plans and barcode lookups. */

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
};

export type MealInput = Omit<MealEntry, "id" | "date" | "eatenAt" | "source" | "barcode" | "planItemId"> & {
  /** Defaults to now. */
  eatenAt?: number;
  /** Defaults to the local day of `eatenAt`. */
  date?: string;
  source?: MealSource;
  barcode?: string | null;
  planItemId?: string | null;
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

/** The active plan as seen on one date: which day applies and which items are already logged. */
export type PlanForDay = { plan: DietPlan; dayIndex: number; day: PlanDay; eatenItemIds: string[] };

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

/** Everything the Dieta tab draws for one day, in one request. */
export type NutritionDay = { summary: DailySummary; meals: MealEntry[]; plan: PlanForDay | null };

/** A food the person logs often, for quick add. Macros are per one logged `quantity`. */
export type FrequentFood = Macros & { name: string; quantity: number; unit: QuantityUnit; slot: MealSlot; barcode: string | null; count: number };
