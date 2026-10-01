import { randomUUID } from "node:crypto";
import type {
  DailySummary,
  DietPlan,
  DietPlanInput,
  FrequentFood,
  Macros,
  MealEntry,
  MealInput,
  MealSlot,
  MealSource,
  NutritionDay,
  NutritionTargets,
  PlanDay,
  PlanForDay,
} from "@pulso/contract";
import { db } from "../db";

const DAY_MS = 86_400_000;
const MACRO_KEYS = ["kcal", "protein", "carbs", "fat", "fiber"] as const;

/** The engine's local calendar day for an instant. The Mac and the phone share a timezone. */
export function localDate(ms = Date.now()): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

const zero = (): Macros => ({ kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
const round = (m: Macros): Macros => Object.fromEntries(MACRO_KEYS.map((k) => [k, Math.round(m[k] * 10) / 10])) as Macros;
function add(into: Macros, m: Macros): Macros {
  for (const k of MACRO_KEYS) into[k] += m[k];
  return into;
}

// --- Meal log ---

type MealRow = {
  id: string;
  date: string;
  eaten_at: number;
  slot: MealSlot;
  name: string;
  quantity: number;
  unit: MealEntry["unit"];
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  source: MealSource;
  barcode: string | null;
  plan_item_id: string | null;
};

const toEntry = (r: MealRow): MealEntry => ({
  id: r.id,
  date: r.date,
  eatenAt: r.eaten_at,
  slot: r.slot,
  name: r.name,
  quantity: r.quantity,
  unit: r.unit,
  kcal: r.kcal,
  protein: r.protein,
  carbs: r.carbs,
  fat: r.fat,
  fiber: r.fiber,
  source: r.source,
  barcode: r.barcode,
  planItemId: r.plan_item_id,
});

export function logMeal(input: MealInput, source: MealSource = input.source ?? "manual"): MealEntry {
  const eatenAt = input.eatenAt ?? Date.now();
  const entry: MealEntry = {
    id: randomUUID(),
    date: input.date ?? localDate(eatenAt),
    eatenAt,
    slot: input.slot,
    name: input.name,
    quantity: input.quantity,
    unit: input.unit,
    kcal: input.kcal,
    protein: input.protein,
    carbs: input.carbs,
    fat: input.fat,
    fiber: input.fiber,
    source,
    barcode: input.barcode ?? null,
    planItemId: input.planItemId ?? null,
  };
  db()
    .query(
      `INSERT INTO meal_entries (id, date, eaten_at, slot, name, quantity, unit, kcal, protein, carbs, fat, fiber, source, barcode, plan_item_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.id, entry.date, entry.eatenAt, entry.slot, entry.name, entry.quantity, entry.unit,
      entry.kcal, entry.protein, entry.carbs, entry.fat, entry.fiber, entry.source, entry.barcode, entry.planItemId,
    );
  return entry;
}

export function logMeals(inputs: MealInput[], source?: MealSource): MealEntry[] {
  return db().transaction(() => inputs.map((input) => logMeal(input, source)))();
}

export function deleteMeal(id: string): boolean {
  return db().query("DELETE FROM meal_entries WHERE id = ?").run(id).changes > 0;
}

/** Entries from `from` to `to` inclusive (YYYY-MM-DD), in eating order. */
export function listMeals(from: string, to: string = from): MealEntry[] {
  return db()
    .query<MealRow, [string, string]>("SELECT * FROM meal_entries WHERE date BETWEEN ? AND ? ORDER BY date, eaten_at")
    .all(from, to)
    .map(toEntry);
}

/** Duplicates a day's entries onto another day, keeping times of day. */
export function copyDay(from: string, to: string): MealEntry[] {
  const shift = daysBetween(from, to) * DAY_MS;
  return logMeals(listMeals(from).map((m) => ({ ...m, date: to, eatenAt: m.eatenAt + shift })));
}

/** Foods logged most in the last 60 days, with the most recent portion and macros. */
export function frequentFoods(limit = 12, today = localDate()): FrequentFood[] {
  const rows = db()
    .query<MealRow & { count: number }, [string, number]>(
      `SELECT m.*, f.count FROM (
         SELECT lower(name) AS key, count(*) AS count, max(eaten_at) AS last FROM meal_entries WHERE date >= ? GROUP BY key
       ) f JOIN meal_entries m ON lower(m.name) = f.key AND m.eaten_at = f.last
       GROUP BY f.key ORDER BY f.count DESC, f.last DESC LIMIT ?`,
    )
    .all(addDays(today, -60), limit);
  return rows.map((r) => ({
    name: r.name, quantity: r.quantity, unit: r.unit, slot: r.slot, barcode: r.barcode, count: r.count,
    kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat, fiber: r.fiber,
  }));
}

// --- Targets ---

type TargetsRow = Macros & { updated_at: number };

export function getTargets(): NutritionTargets | null {
  const row = db().query<TargetsRow, []>("SELECT kcal, protein, carbs, fat, fiber, updated_at FROM nutrition_targets WHERE id = 1").get();
  return row ? { kcal: row.kcal, protein: row.protein, carbs: row.carbs, fat: row.fat, fiber: row.fiber, updatedAt: row.updated_at } : null;
}

export function setTargets(input: Omit<Macros, "fiber"> & { fiber?: number }): NutritionTargets {
  const targets: NutritionTargets = { ...input, fiber: input.fiber ?? Math.round((input.kcal / 1000) * 14), updatedAt: Date.now() };
  db()
    .query(
      `INSERT INTO nutrition_targets (id, kcal, protein, carbs, fat, fiber, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET kcal = excluded.kcal, protein = excluded.protein, carbs = excluded.carbs,
         fat = excluded.fat, fiber = excluded.fiber, updated_at = excluded.updated_at`,
    )
    .run(targets.kcal, targets.protein, targets.carbs, targets.fat, targets.fiber, targets.updatedAt);
  return targets;
}

// --- Summaries ---

function summarize(date: string, meals: MealEntry[], targets: NutritionTargets | null): DailySummary {
  const totals = zero();
  const bySlot: DailySummary["bySlot"] = {};
  for (const m of meals) {
    add(totals, m);
    bySlot[m.slot] = add(bySlot[m.slot] ?? zero(), m);
  }
  for (const s of Object.keys(bySlot) as MealSlot[]) bySlot[s] = round(bySlot[s]!);
  const remaining = targets && round(Object.fromEntries(MACRO_KEYS.map((k) => [k, targets[k] - totals[k]])) as Macros);
  return { date, totals: round(totals), targets, remaining, bySlot, entries: meals.length };
}

export function dailySummary(date: string): DailySummary {
  return summarize(date, listMeals(date), getTargets());
}

/** One summary per day from `from` to `to` inclusive, empty days included. Targets are today's. */
export function summaries(from: string, to: string): DailySummary[] {
  const meals = listMeals(from, to);
  const targets = getTargets();
  const out: DailySummary[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    out.push(summarize(date, meals.filter((m) => m.date === date), targets));
  }
  return out;
}

// --- Diet plans ---

type PlanRow = { id: string; name: string; notes: string | null; starts_on: string; active: number; created_at: number; days_json: string };

const toPlan = (r: PlanRow): DietPlan => ({
  id: r.id,
  name: r.name,
  notes: r.notes,
  startsOn: r.starts_on,
  active: r.active === 1,
  createdAt: r.created_at,
  days: JSON.parse(r.days_json) as PlanDay[],
});

/** Stores a whole plan, assigning ids to every item. Activating it deactivates the previous one. */
export function createPlan(input: DietPlanInput): DietPlan {
  const plan: DietPlan = {
    id: randomUUID(),
    name: input.name,
    notes: input.notes ?? null,
    startsOn: input.startsOn ?? localDate(),
    active: input.activate ?? true,
    createdAt: Date.now(),
    days: input.days.map((d) => ({
      label: d.label,
      meals: d.meals.map((m) => ({ slot: m.slot, name: m.name ?? null, items: m.items.map((i) => ({ ...i, id: randomUUID() })) })),
    })),
  };
  db().transaction(() => {
    if (plan.active) db().query("UPDATE diet_plans SET active = 0 WHERE active = 1").run();
    db()
      .query("INSERT INTO diet_plans (id, name, notes, starts_on, active, created_at, days_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(plan.id, plan.name, plan.notes, plan.startsOn, plan.active ? 1 : 0, plan.createdAt, JSON.stringify(plan.days));
  })();
  return plan;
}

export function activePlan(): DietPlan | null {
  const row = db().query<PlanRow, []>("SELECT * FROM diet_plans WHERE active = 1 ORDER BY created_at DESC LIMIT 1").get();
  return row ? toPlan(row) : null;
}

/** Which plan day applies on `date`: days cycle from `startsOn`. */
export function planDayIndex(plan: Pick<DietPlan, "startsOn" | "days">, date: string): number {
  const n = plan.days.length;
  return ((daysBetween(plan.startsOn, date) % n) + n) % n;
}

export function planForDay(date: string, meals: MealEntry[] = listMeals(date)): PlanForDay | null {
  const plan = activePlan();
  if (!plan) return null;
  const dayIndex = planDayIndex(plan, date);
  const eaten = new Set(meals.map((m) => m.planItemId).filter((id): id is string => id !== null));
  const day = plan.days[dayIndex]!;
  const eatenItemIds = day.meals.flatMap((m) => m.items.map((i) => i.id)).filter((id) => eaten.has(id));
  return { plan, dayIndex, day, eatenItemIds };
}

/** Logs a plan item of the active plan as eaten. Undefined when the item is not in it. */
export function eatPlanItem(itemId: string, date = localDate(), eatenAt?: number): MealEntry | undefined {
  const plan = activePlan();
  for (const day of plan?.days ?? []) {
    for (const meal of day.meals) {
      const item = meal.items.find((i) => i.id === itemId);
      if (!item) continue;
      const { id: _id, ...food } = item;
      return logMeal({ ...food, slot: meal.slot, date, eatenAt, planItemId: item.id }, "plan");
    }
  }
  return undefined;
}

export function nutritionDay(date: string): NutritionDay {
  const meals = listMeals(date);
  return { summary: summarize(date, meals, getTargets()), meals, plan: planForDay(date, meals) };
}
