import { randomUUID } from "node:crypto";
import type {
  DailySummary,
  DayAdjustment,
  DietPlan,
  DietPlanInput,
  FrequentFood,
  Macros,
  MealEntry,
  MealInput,
  Measure,
  MealSlot,
  MealSource,
  NutritionDay,
  NutritionTargets,
  PlanDay,
  PlanForDay,
} from "@pulso/contract";
import { db } from "../db";
import { addDays, DAY_MS, daysBetween, localDate } from "./dates";
import { add, MACRO_KEYS, round, zero } from "./macros";
import { dayRow, itemsOf, linkEntry, materialize, planDayIndex, slotRows } from "./slots";
import { waterDay } from "./water";

export { add, addDays, localDate, MACRO_KEYS, planDayIndex, round, zero };

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
  slot_id: string | null;
  off_plan: number | null;
  note: string | null;
  measure_amount: number | null;
  measure_unit: Measure["unit"] | null;
  measure_size: number | null;
  caffeine_mg: number | null;
  alcohol_g: number | null;
};

const measureOf = (r: MealRow): Measure | null =>
  r.measure_amount !== null && r.measure_unit !== null ? { amount: r.measure_amount, unit: r.measure_unit, size: r.measure_size } : null;

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
  slotId: r.slot_id,
  offPlan: r.off_plan === 1,
  note: r.note,
  measure: measureOf(r),
  caffeineMg: r.caffeine_mg,
  alcoholG: r.alcohol_g,
});

// Every meal_entries read joins its side tables.
const ENTRY_SELECT = `SELECT m.*, c.off_plan, c.note, d.measure_amount, d.measure_unit, d.measure_size, d.caffeine_mg, d.alcohol_g, l.slot_id
  FROM meal_entries m LEFT JOIN meal_entry_context c ON c.entry_id = m.id LEFT JOIN meal_entry_detail d ON d.entry_id = m.id
  LEFT JOIN meal_slot_links l ON l.entry_id = m.id`;

export function logMeal(input: MealInput, source: MealSource = input.source ?? "manual"): MealEntry {
  const eatenAt = Math.round(input.eatenAt ?? Date.now());
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
    slotId: null,
    offPlan: input.offPlan ?? false,
    note: input.note?.trim() || null,
    measure: input.measure ?? null,
    caffeineMg: input.caffeineMg ?? null,
    alcoholG: input.alcoholG ?? null,
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
  if (entry.offPlan || entry.note) {
    db().query("INSERT INTO meal_entry_context (entry_id, off_plan, note) VALUES (?, ?, ?)").run(entry.id, entry.offPlan ? 1 : 0, entry.note);
  }
  if (entry.measure || entry.caffeineMg !== null || entry.alcoholG !== null) {
    db()
      .query("INSERT INTO meal_entry_detail (entry_id, measure_amount, measure_unit, measure_size, caffeine_mg, alcohol_g) VALUES (?, ?, ?, ?, ?, ?)")
      .run(entry.id, entry.measure?.amount ?? null, entry.measure?.unit ?? null, entry.measure?.size ?? null, entry.caffeineMg, entry.alcoholG);
  }
  entry.slotId = linkEntry({ ...entry, slotId: input.slotId });
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
    .query<MealRow, [string, string]>(`${ENTRY_SELECT} WHERE m.date BETWEEN ? AND ? ORDER BY m.date, m.eaten_at`)
    .all(from, to)
    .map(toEntry);
}

/** Duplicates a day's entries onto another day, keeping times of day. */
export function copyDay(from: string, to: string): MealEntry[] {
  const shift = daysBetween(from, to) * DAY_MS;
  return logMeals(listMeals(from).map((m) => ({ ...m, date: to, eatenAt: m.eatenAt + shift })));
}

/**
 * Foods logged most in the last 60 days, with the most recent portion and macros.
 * `snacks` keeps those last logged as a snack or in ml (drinks).
 */
export function frequentFoods(limit = 12, today = localDate(), snacks = false): FrequentFood[] {
  const rows = db()
    .query<MealRow & { count: number }, [string, number]>(
      `SELECT e.*, f.count FROM (
         SELECT lower(name) AS key, count(*) AS count, max(eaten_at) AS last FROM meal_entries WHERE date >= ? GROUP BY key
       ) f JOIN (${ENTRY_SELECT}) e ON lower(e.name) = f.key AND e.eaten_at = f.last
       ${snacks ? "WHERE e.slot = 'snack' OR e.unit = 'ml'" : ""}
       GROUP BY f.key ORDER BY f.count DESC, f.last DESC LIMIT ?`,
    )
    .all(addDays(today, -60), limit);
  return rows.map((r) => ({
    name: r.name, quantity: r.quantity, unit: r.unit, measure: measureOf(r), slot: r.slot, barcode: r.barcode, count: r.count,
    kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat, fiber: r.fiber, caffeineMg: r.caffeine_mg, alcoholG: r.alcohol_g,
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
  let caffeineMg = 0;
  let alcoholG = 0;
  for (const m of meals) {
    add(totals, m);
    bySlot[m.slot] = add(bySlot[m.slot] ?? zero(), m);
    caffeineMg += m.caffeineMg ?? 0;
    alcoholG += m.alcoholG ?? 0;
  }
  for (const s of Object.keys(bySlot) as MealSlot[]) bySlot[s] = round(bySlot[s]!);
  const remaining = targets && round(Object.fromEntries(MACRO_KEYS.map((k) => [k, targets[k] - totals[k]])) as Macros);
  return {
    date, totals: round(totals), targets, remaining, bySlot, entries: meals.length,
    caffeineMg: Math.round(caffeineMg), alcoholG: Math.round(alcoholG * 10) / 10,
  };
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

/**
 * The plan as written for `date`. From today on the date is laid out as dated
 * slots (see slots.ts) and the day is read from them, skipped and replaced
 * meals left out; earlier dates never laid out read the rotation.
 */
export function plannedDay(plan: DietPlan, date: string): PlanDay {
  if (date >= localDate()) materialize(plan, date);
  const marker = dayRow(plan.id, date);
  if (!marker) return plan.days[planDayIndex(plan, date)]!;
  const meals = slotRows(plan.id, date)
    .filter((r) => r.status === "planned")
    .map((r) => ({ slot: r.slot, name: r.name, items: itemsOf(r) }));
  return { label: marker.label, meals };
}

export function planForDay(date: string, meals: MealEntry[] = listMeals(date)): PlanForDay | null {
  const plan = activePlan();
  if (!plan) return null;
  const dayIndex = planDayIndex(plan, date);
  const eaten = new Set(meals.map((m) => m.planItemId).filter((id): id is string => id !== null));
  const day = plannedDay(plan, date);
  const adjustment = getAdjustment(date, plan.id);
  const ids = new Set([day, adjustment ?? { meals: [] }].flatMap((d) => d.meals.flatMap((m) => m.items.map((i) => i.id))));
  const eatenItemIds = [...ids].filter((id) => eaten.has(id));
  return { plan, dayIndex, day, eatenItemIds, adjustment };
}

/**
 * Logs a plan item as eaten on `date`: the day's adjusted portion when the Coach
 * adjusted it, else the dated plan's, else the rotation's. Undefined when the item is in none.
 */
export function eatPlanItem(itemId: string, date = localDate(), eatenAt?: number): MealEntry | undefined {
  const plan = activePlan();
  const adjusted = plan ? getAdjustment(date, plan.id) : null;
  const dated = plan ? plannedDay(plan, date) : null;
  for (const day of [...(adjusted ? [adjusted] : []), ...(dated ? [dated] : []), ...(plan?.days ?? [])]) {
    for (const meal of day.meals) {
      const item = meal.items.find((i) => i.id === itemId);
      if (!item) continue;
      const { id: _id, ...food } = item;
      return logMeal({ ...food, slot: meal.slot, date, eatenAt, planItemId: item.id }, "plan");
    }
  }
  return undefined;
}

// --- Day adjustments (the Coach's rewrite of what is left of a day; see ./adjust.ts) ---

/** The adjustment for `date`, if it was made on top of `planId` (a newer plan voids it). */
export function getAdjustment(date: string, planId: string): DayAdjustment | null {
  const row = db()
    .query<{ adjustment_json: string }, [string, string]>("SELECT adjustment_json FROM plan_adjustments WHERE date = ? AND plan_id = ?")
    .get(date, planId);
  return row ? (JSON.parse(row.adjustment_json) as DayAdjustment) : null;
}

export function saveAdjustment(adjustment: DayAdjustment): DayAdjustment {
  db()
    .query(
      `INSERT INTO plan_adjustments (date, plan_id, adjustment_json, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (date) DO UPDATE SET plan_id = excluded.plan_id, adjustment_json = excluded.adjustment_json, created_at = excluded.created_at`,
    )
    .run(adjustment.date, adjustment.planId, JSON.stringify(adjustment), adjustment.createdAt);
  return adjustment;
}

/** Back to the plan as written for `date`. */
export function clearAdjustment(date: string): boolean {
  return db().query("DELETE FROM plan_adjustments WHERE date = ?").run(date).changes > 0;
}

export function nutritionDay(date: string): NutritionDay {
  const meals = listMeals(date);
  return { summary: summarize(date, meals, getTargets()), meals, plan: planForDay(date, meals), water: waterDay(date) };
}
