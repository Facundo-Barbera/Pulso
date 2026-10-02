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
  /** The dated plan slot this entry is the real meal of (eaten as planned, or instead); null for an extra. */
  slotId: string | null;
  /** Derived: true when it was eaten instead of the planned meal of `slotId`. Kept for older clients. */
  offPlan: boolean;
  /** The person's own words for the meal, e.g. "Big Mac y papas medianas". */
  note: string | null;
  /** The amount as said ("2 latas"); null when it was logged straight in g, ml or servings. */
  measure: Measure | null;
  /** The dish (platillo) this entry is a component of; null for a food logged on its own. */
  dish: DishRef | null;
};

/**
 * A dish eaten: several foods eaten together as one thing ("Batido de proteína
 * con fresas"). Its components are ordinary entries carrying this ref, so day
 * totals, the plan and history read them as before; the dish's total is theirs.
 */
export type DishRef = {
  id: string;
  name: string;
  /** The saved dish (Mis platillos) it was logged from, if any. */
  savedDishId: string | null;
};

export type MealInput = Omit<
  MealEntry,
  "id" | "date" | "eatenAt" | "source" | "barcode" | "planItemId" | "slotId" | "offPlan" | "note" | "measure" | "caffeineMg" | "alcoholG" | "dish"
> & {
  /** Defaults to now. */
  eatenAt?: number;
  /** Defaults to the local day of `eatenAt`. */
  date?: string;
  source?: MealSource;
  barcode?: string | null;
  planItemId?: string | null;
  /** The slot this meal is; omitted, the engine finds it (see reconcile.ts). */
  slotId?: string | null;
  /** With slotId: eaten instead of that meal even if it carries plan items. Otherwise ignored. */
  offPlan?: boolean;
  note?: string | null;
  measure?: Measure | null;
  caffeineMg?: number | null;
  alcoholG?: number | null;
};

/**
 * How a nutrient's zone reads: `min` = reach at least `min` (protein, fiber; going
 * past `max` is fine, `max` only ends the band drawn); `range` = stay between `min`
 * and `max` (kcal, carbs, fat); `max` = stay under `max`.
 */
export type ZoneKind = "min" | "range" | "max";

/** The "estás bien aquí" band around one target. kcal or grams, like the target. */
export type TargetZone = {
  kind: ZoneKind;
  /** null for `max` zones. */
  min: number | null;
  max: number | null;
  /** Set by the Coach or the person; false when derived from the target and the body goal. */
  custom: boolean;
};

export type ZoneStatus = "below" | "inZone" | "above";

/** One nutrient of one day against its zone. `above` only exists for `range` and `max` zones. */
export type NutrientZone = TargetZone & { value: number; target: number; status: ZoneStatus };

export type NutritionTargets = Macros & { updatedAt: number; zones: Record<keyof Macros, TargetZone> };

/** A zone as set by the Coach or the person: either bound may be left out (kind follows from which are given). */
export type ZoneInput = { min?: number | null; max?: number | null; kind?: ZoneKind };

export type DailySummary = {
  date: string;
  totals: Macros;
  /** null until targets are set. */
  targets: NutritionTargets | null;
  /** targets − totals (negative = over). null without targets. */
  remaining: Macros | null;
  /** Each nutrient against its zone; null without targets. */
  zones: Record<keyof Macros, NutrientZone> | null;
  /** Something logged, kcal in its zone and protein at least its minimum. False without targets. */
  inZone: boolean;
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

/** A packaged food from Open Food Facts. Macros per 100 g, or per 100 ml when `liquid`. */
export type FoodProduct = {
  barcode: string;
  name: string;
  brand: string | null;
  per100g: Macros;
  /** Grams (ml when `liquid`) in one serving, when the label says. */
  servingGrams: number | null;
  imageUrl: string | null;
  /** A drink, counted in ml: the package or serving is in ml/cl/L, or it is filed under beverages. */
  liquid: boolean;
  /** Grams (ml when `liquid`) in the package as sold; one unit of a multipack ("6 x 330 ml" → 330). */
  packageSize: number | null;
  /** The package, when Open Food Facts knows it, so a drink logs as "1 lata" or "1 botella". */
  packageKind: "lata" | "botella" | null;
};

/**
 * How much of a packaged product an amount said in words is ("una cucharada",
 * "la mitad del paquete", "3 galletas"), with the macros for it.
 */
export type PortionEstimate = {
  barcode: string;
  name: string;
  /** g, or ml for a drink. */
  quantity: number;
  unit: "g" | "ml";
  /** Totals for `quantity`. */
  macros: Macros;
  /** The amount as said, to log; null for a share of a package that isn't a can or bottle. */
  measure: Measure | null;
  /** Share of the package (0–1) when its size is known. */
  packageShare: number | null;
  /** One line in Spanish: "1 cucharada de Crema de cacahuete ≈ 16 g → 94 kcal". */
  assumption: string;
};

/** `POST …/nutrition/portion` (phone) and `…/dieta/portion` (web). */
export type PortionRequest = { barcode: string; amount: string };

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

/** Everything the Dieta tab draws for one day, in one request. `dishes` are the saved ones, most used first. */
export type NutritionDay = { summary: DailySummary; meals: MealEntry[]; plan: PlanForDay | null; water: WaterDay; dishes: SavedDish[] };

/** One food in a saved dish, as it is logged by default. Macros are totals for its amount. */
export type DishComponent = Macros &
  Stimulants & { name: string; quantity: number; unit: QuantityUnit; measure: Measure | null; barcode: string | null };

/** A saved dish (Mis platillos): a reusable template, logged in one tap and optionally scaled or tweaked. */
export type SavedDish = {
  id: string;
  name: string;
  /** The meal it is usually eaten as; null when it varies. */
  slot: MealSlot | null;
  /** One default portion. */
  components: DishComponent[];
  /** Totals of the components: kcal and grams. */
  macros: Macros;
  /** The plan recipe it was saved from, if any. */
  recipeId: string | null;
  /** Times logged. */
  uses: number;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

/** How to log a saved dish this time: scaled ("medio" = 0.5) and with one-off changes to its components. */
export type LogDishOptions = {
  /** Portion factor, 1 by default. */
  scale?: number;
  /** One-off changes: a component (index or name) with a new amount in words ("300 ml"), or removed. */
  overrides?: { component: number | string; measure?: string; remove?: boolean }[];
};

/** A food the person logs often, for quick add. Macros are per one logged `quantity`. */
export type FrequentFood = Macros &
  Stimulants & { name: string; quantity: number; unit: QuantityUnit; measure: Measure | null; slot: MealSlot; barcode: string | null; count: number };
