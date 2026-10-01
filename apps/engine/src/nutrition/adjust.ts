/**
 * Adapting the rest of a day to what was actually eaten. The arithmetic is
 * deterministic (what is left, which planned meals are still ahead, scaling
 * their portions); the Coach only chooses swaps, which this then accounts for.
 */
import { randomUUID } from "node:crypto";
import { MEAL_SLOTS, type AdjustedMeal, type DayAdjustment, type Macros, type MealEntry, type MealSlot, type PlanItem, type PlanMeal } from "@pulso/contract";
import { add, MACRO_KEYS, round, zero } from "./macros";
import { dayRow } from "./slots";
import { clearAdjustment, getAdjustment, getTargets, listMeals, planForDay, saveAdjustment } from "./store";

/** Remaining meals are never cut below half nor grown past half again: the rest is the week's job, not tonight's. */
export const MIN_FACTOR = 0.5;
export const MAX_FACTOR = 1.5;

export const SLOT_TITLES: Record<MealSlot, string> = {
  desayuno: "desayuno",
  media_manana: "media mañana",
  comida: "comida",
  merienda: "merienda",
  cena: "cena",
  snack: "snack",
};

const order = (slot: MealSlot) => MEAL_SLOTS.indexOf(slot);
const sum = (items: Macros[]): Macros => round(items.reduce((total, m) => add(total, m), zero()));
const mealsTotal = (meals: PlanMeal[]) => sum(meals.flatMap((m) => m.items));

/**
 * Planned meals still ahead: nothing logged in their slot yet and later than the
 * last main meal logged (a skipped breakfast is past, not pending). Snacks stay
 * ahead until one is logged.
 */
export function mealsAhead(planned: PlanMeal[], eaten: MealEntry[]): PlanMeal[] {
  const logged = new Set(eaten.map((m) => m.slot));
  const last = Math.max(-1, ...eaten.filter((m) => m.slot !== "snack").map((m) => order(m.slot)));
  return planned.filter((m) => !logged.has(m.slot) && (m.slot === "snack" || order(m.slot) > last));
}

/** Grams and ml to 5, servings to halves; never below one step. */
export function roundQuantity(quantity: number, unit: PlanItem["unit"]): number {
  return unit !== "serving" ? Math.max(5, Math.round(quantity / 5) * 5) : Math.max(0.5, Math.round(quantity * 2) / 2);
}

/** Scales an item's portion, then its macros by the portion actually kept after rounding. */
export function scaleItem(item: PlanItem, factor: number): PlanItem {
  const quantity = roundQuantity(item.quantity * factor, item.unit);
  const kept = quantity / item.quantity;
  const macros = round(Object.fromEntries(MACRO_KEYS.map((k) => [k, item[k] * kept])) as Macros);
  return { ...item, ...macros, kcal: Math.round(item.kcal * kept), quantity };
}

export type Rebalance = { factor: number; meals: AdjustedMeal[]; projected: Macros };

/**
 * The meals ahead, rewritten so the day lands on target: swaps are taken as
 * given, every other planned meal is scaled by one factor (clamped to
 * MIN_FACTOR..MAX_FACTOR) so that eaten + swaps + scaled ≈ the kcal target.
 * `maxChangeKcal` bounds how much the scaled meals may move in total, so a
 * day is never pushed to an extreme; what is left over stays a deviation.
 */
export function rebalance(targets: Macros, eaten: Macros, ahead: PlanMeal[], swaps: PlanMeal[] = [], maxChangeKcal?: number): Rebalance {
  const swapped = new Set(swaps.map((m) => m.slot));
  const scalable = ahead.filter((m) => !swapped.has(m.slot));
  const planned = mealsTotal(scalable).kcal;
  const budget = targets.kcal - eaten.kcal - mealsTotal(swaps).kcal;
  const raw = planned > 0 ? budget / planned : 1;
  let factor = Math.round(Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, raw)) * 100) / 100;
  if (maxChangeKcal !== undefined && planned > 0) {
    // Rounded toward 1, so rounding never breaks the bound.
    const bound = maxChangeKcal / planned;
    if (factor > 1 + bound) factor = Math.floor((1 + bound) * 100) / 100;
    if (factor < 1 - bound) factor = Math.ceil((1 - bound) * 100) / 100;
  }
  const scaled = (f: number) => scalable.map((m) => ({ ...m, items: m.items.map((i) => scaleItem(i, f)) }));
  // Portions round (5 g, half servings), which can overshoot the bound: step back toward 1 until it holds.
  while (maxChangeKcal !== undefined && factor !== 1 && Math.abs(mealsTotal(scaled(factor)).kcal - planned) > maxChangeKcal) {
    factor = Math.round((factor + (factor > 1 ? -0.01 : 0.01)) * 100) / 100;
  }
  const same = Math.abs(factor - 1) < 0.03;
  const meals: AdjustedMeal[] = [
    ...(same ? scalable.map((m): AdjustedMeal => ({ ...m, change: "same" })) : scaled(factor).map((m): AdjustedMeal => ({ ...m, change: "scaled" }))),
    ...swaps.map((m): AdjustedMeal => ({ ...m, change: "swapped" })),
  ].sort((a, b) => order(a.slot) - order(b.slot));
  return { factor: same ? 1 : factor, meals, projected: sum([eaten, mealsTotal(meals)]) };
}

const n = (value: number) => Math.round(value).toLocaleString("es-ES");

function list(words: string[]): string {
  return words.length < 2 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} y ${words.at(-1)}`;
}

/** One line in Spanish for the person: what changed and where the day ends. */
export function describe({ factor, meals, projected }: Rebalance, targets: Macros, eaten: Macros): string {
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (!meals.length) {
    const left = targets.kcal - eaten.kcal;
    return `No quedan comidas del plan hoy: llevas ${n(eaten.kcal)} de ${n(targets.kcal)} kcal (${left >= 0 ? `faltan ${n(left)}` : `+${n(-left)}`}).`;
  }
  const parts: string[] = [];
  const scaled = meals.filter((m) => m.change === "scaled").map((m) => SLOT_TITLES[m.slot]);
  const swapped = meals.filter((m) => m.change === "swapped").map((m) => SLOT_TITLES[m.slot]);
  if (scaled.length) parts.push(`${list(scaled)} al ${Math.round(factor * 100)} %`);
  if (swapped.length) parts.push(`${list(swapped)} con cambios`);
  const changes = parts.length ? `${capitalize(list(parts))}. ` : "El resto del plan queda igual. ";
  const off = projected.kcal - targets.kcal;
  const end = `Cierras el día en ${n(projected.kcal)} de ${n(targets.kcal)} kcal`;
  const margin = targets.kcal * 0.05;
  const over = off > margin ? ` (+${n(off)}, lo compensa la semana)` : off < -margin ? ` (faltan ${n(-off)})` : "";
  return `${changes}${end}${over} y ${n(projected.protein)} de ${n(targets.protein)} g de proteína.`;
}

export type AdjustOptions = {
  /** Replacement meals for some slots, chosen by the Coach. Earlier swaps for slots still ahead are kept unless replaced. */
  swaps?: { slot: MealSlot; name?: string | null; items: Omit<PlanItem, "id">[] }[];
  /** Which planned slots count as still ahead, when the time-of-day rule would get it wrong. */
  slots?: MealSlot[];
  note?: string | null;
  /** Drop earlier swaps instead of keeping them. */
  resetSwaps?: boolean;
  /** Most the remaining meals may move, as a % of the day's goal (e.g. 15). Unbounded (only 50–150 % per meal) when absent. */
  maxChangePct?: number;
};

export type AdjustResult = DayAdjustment & { stored: boolean };

/**
 * Recomputes what is left of `date` against the targets (or, without targets,
 * the plan day's own total) and stores the rewritten remaining meals as that
 * day's adjustment. The plan itself is never changed. Throws without an active plan.
 */
export function adjustDayPlan(date: string, options: AdjustOptions = {}): AdjustResult {
  const eatenEntries = listMeals(date);
  const forDay = planForDay(date, eatenEntries);
  if (!forDay) throw new Error("No active diet plan: use daily_summary's remaining macros instead.");
  const { plan, dayIndex, day } = forDay;
  // The day's goal: targets (or the plan day's own total) plus whatever a spread moved onto it.
  const base = getTargets() ?? mealsTotal(day.meals);
  const targets = { ...base, kcal: base.kcal + (dayRow(plan.id, date)?.shift_kcal ?? 0) };
  const eaten = sum(eatenEntries);

  const ahead = options.slots ? day.meals.filter((m) => options.slots!.includes(m.slot)) : mealsAhead(day.meals, eatenEntries);
  const aheadSlots = new Set([...ahead.map((m) => m.slot), ...(options.slots ?? [])]);
  const given = (options.swaps ?? []).map((m): PlanMeal => ({ slot: m.slot, name: m.name ?? null, items: m.items.map((i) => ({ ...i, id: randomUUID() })) }));
  const givenSlots = new Set(given.map((m) => m.slot));
  const kept = options.resetSwaps
    ? []
    : (getAdjustment(date, plan.id)?.meals ?? []).filter((m) => m.change === "swapped" && !givenSlots.has(m.slot) && aheadSlots.has(m.slot) && !eatenEntries.some((e) => e.slot === m.slot));
  const swaps = [...given, ...kept.map(({ change: _change, ...m }) => m)];

  const maxChange = options.maxChangePct !== undefined ? (targets.kcal * options.maxChangePct) / 100 : undefined;
  const result = rebalance(targets, eaten, ahead, swaps, maxChange);
  const adjustment: DayAdjustment = {
    date,
    planId: plan.id,
    dayIndex,
    factor: result.factor,
    meals: result.meals,
    eaten,
    targets: { kcal: targets.kcal, protein: targets.protein, carbs: targets.carbs, fat: targets.fat, fiber: targets.fiber },
    projected: result.projected,
    summary: describe(result, targets, eaten),
    note: options.note?.trim() || null,
    createdAt: Date.now(),
  };
  if (!adjustment.meals.length) {
    clearAdjustment(date);
    return { ...adjustment, stored: false };
  }
  return { ...saveAdjustment(adjustment), stored: true };
}
