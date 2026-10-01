/** Reading the dated plan: slots with their status, days, prep batches and the horizon the UIs draw. */
import type { DietDay, DietHorizon, DietPlan, Macros, PlanItem, PlanSlot, PrepBatch, RealMeal, SlotStatus } from "@pulso/contract";
import { db } from "../db";
import type { Line } from "../shopping/aggregate";
import { addDays, localDate } from "./dates";
import { pick, sum } from "./macros";
import { eatenWords, mealClock, minuteOfDay, MISSED_AFTER_MIN, repairOnce } from "./reconcile";
import { findRecipe, ingredientLines, prepRows, type PrepRow } from "./recipes";
import { lastRevision } from "./revisions";
import { dayRow, horizonDays, itemsOf, linksOf, materializeRange, slotRows, type LinkRow, type SlotRow } from "./slots";
import { activePlan, getAdjustment, getTargets, listMeals } from "./store";

export class PlanError extends Error {}

export function requirePlan(): DietPlan {
  const plan = activePlan();
  if (!plan) throw new PlanError("No active diet plan: create one with create_diet_plan first.");
  return plan;
}

export function statusOf(row: SlotRow, links: LinkRow[]): SlotStatus {
  if (row.status !== "planned") return row.status;
  return links.some((l) => l.slot_id === row.id && l.role === "planned") ? "eaten" : "planned";
}

type LinkedEntry = Macros & { id: string; name: string; eaten_at: number };

/** The entries tied to a slot, as one real meal. */
function realMeal(own: LinkRow[], entries: Map<string, LinkedEntry>): RealMeal | null {
  const eaten = own.map((l) => entries.get(l.entry_id)).filter((e): e is LinkedEntry => !!e).sort((a, b) => a.eaten_at - b.eaten_at);
  if (!eaten.length) return null;
  return {
    label: eatenWords(eaten.map((e) => e.name)),
    entryIds: eaten.map((e) => e.id),
    macros: sum(eaten.map(pick)),
    eatenAt: eaten[0]!.eaten_at,
    asPlanned: own.every((l) => l.role === "planned"),
  };
}

/** Slot rows as the UIs and the Coach see them. `now` decides which pending meals read «sin registrar». */
export function slotViews(rows: SlotRow[], now = Date.now()): PlanSlot[] {
  const links = linksOf(rows.map((r) => r.id));
  const entries = new Map(
    links.length
      ? db()
          .query<LinkedEntry, string[]>(`SELECT id, name, eaten_at, kcal, protein, carbs, fat, fiber FROM meal_entries WHERE id IN (${links.map(() => "?").join(",")})`)
          .all(...links.map((l) => l.entry_id))
          .map((e) => [e.id, e])
      : [],
  );
  const today = localDate(now);
  const clocks = new Map<string, ReturnType<typeof mealClock>>();
  const missed = (row: SlotRow) => {
    if (row.date > today) return false;
    if (row.date < today) return true;
    if (!clocks.has(row.date)) clocks.set(row.date, mealClock(row.date));
    return minuteOfDay(now) >= clocks.get(row.date)![row.slot] + MISSED_AFTER_MIN;
  };
  const adjustments = new Map<string, ReturnType<typeof getAdjustment>>();
  return rows.map((row) => {
    if (!adjustments.has(row.date)) adjustments.set(row.date, getAdjustment(row.date, row.plan_id));
    const status = statusOf(row, links);
    const own = links.filter((l) => l.slot_id === row.id);
    const items = itemsOf(row);
    const meal = status === "planned" ? adjustments.get(row.date)?.meals.find((m) => m.slot === row.slot && m.change !== "same") : undefined;
    const adjusted: PlanItem[] | null = meal?.items ?? null;
    const replacedBy = own.filter((l) => l.role === "replacement").map((l) => entries.get(l.entry_id)?.name).filter(Boolean);
    const recipe = row.kind === "recipe" && row.recipe_id ? findRecipe(row.recipe_id) : null;
    return {
      id: row.id,
      planId: row.plan_id,
      date: row.date,
      slot: row.slot,
      kind: row.kind,
      name: row.name,
      recipeId: row.recipe_id,
      prepId: row.prep_id,
      portions: row.portions,
      items,
      adjusted,
      macros: sum(adjusted ?? items),
      status,
      entryIds: own.map((l) => l.entry_id),
      replacedBy: replacedBy.length ? replacedBy.join(", ") : null,
      real: realMeal(own, entries),
      missed: status === "planned" && missed(row),
      cookMinutes: row.kind === "prep" || row.kind === "eat_out" ? 0 : recipe ? recipe.prepMinutes : null,
      note: row.note,
    };
  });
}

export function dietDay(plan: DietPlan, date: string): DietDay {
  repairOnce();
  materializeRange(plan, date, date);
  const slots = slotViews(slotRows(plan.id, date));
  const marker = dayRow(plan.id, date)!;
  const counted = slots.filter((s) => s.status === "planned" || s.status === "eaten");
  const planned = sum(counted.map((s) => s.macros));
  const goal = getTargets()?.kcal ?? sum(slots.filter((s) => s.status !== "replaced").flatMap((s) => s.items)).kcal;
  const logged = listMeals(date);
  return {
    date,
    label: marker.label,
    slots,
    planned,
    asPlanned: sum(slots.flatMap((s) => s.items)),
    real: sum(logged.map(pick)),
    extraIds: logged.filter((e) => !e.slotId).map((e) => e.id),
    shiftKcal: marker.shift_kcal,
    goalKcal: Math.round(goal + marker.shift_kcal),
    adjustment: getAdjustment(date, plan.id),
  };
}

export function prepView(row: PrepRow): PrepBatch {
  const rows = db().query<SlotRow, [string]>("SELECT * FROM plan_slots WHERE prep_id = ? AND kind = 'prep'").all(row.id);
  const links = linksOf(rows.map((r) => r.id));
  const assigned = rows.filter((r) => r.status === "planned");
  const used = assigned.reduce((total, r) => total + (r.portions ?? 1), 0);
  return {
    id: row.id,
    planId: row.plan_id,
    recipeId: row.recipe_id,
    recipeName: findRecipe(row.recipe_id)?.name ?? "Receta",
    cookDate: row.cook_date,
    portions: row.portions,
    status: row.status,
    cookedAt: row.cooked_at,
    slotIds: assigned.map((r) => r.id),
    eaten: assigned.filter((r) => statusOf(r, links) === "eaten").reduce((total, r) => total + (r.portions ?? 1), 0),
    leftover: Math.max(0, Math.round((row.portions - used) * 10) / 10),
  };
}

export const prepViews = (planId: string): PrepBatch[] => prepRows(planId).map(prepView);

/** The active plan from `from` (default today) for `days` days (default the plan's horizon), laid out as dated slots. Null without a plan. */
export function dietHorizon(from = localDate(), days?: number): DietHorizon | null {
  const plan = activePlan();
  if (!plan) return null;
  const length = days ?? horizonDays(plan.id);
  const to = addDays(from, length - 1);
  materializeRange(plan, from, to);
  const out: DietDay[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) out.push(dietDay(plan, date));
  return {
    planId: plan.id,
    planName: plan.name,
    from,
    to,
    horizonDays: horizonDays(plan.id),
    days: out,
    preps: prepViews(plan.id).filter((p) => p.status !== "discarded" && (p.cookDate >= addDays(from, -7) || p.leftover > 0)),
    lastRevision: lastRevision(plan.id),
  };
}

/**
 * What the plan still needs bought over [from, to]: items of meals not yet
 * eaten, skipped or replaced, ingredients of recipes cooked on the day, and
 * whole batches still to cook in the range (their portions need nothing more).
 */
export function planLines(plan: DietPlan, from: string, to: string): Line[] {
  materializeRange(plan, from, to);
  const rows = slotRows(plan.id, from, to);
  const links = linksOf(rows.map((r) => r.id));
  const lines: Line[] = [];
  for (const row of rows) {
    if (statusOf(row, links) !== "planned") continue;
    if (row.kind === "items") lines.push(...itemsOf(row));
    const recipe = row.kind === "recipe" && row.recipe_id ? findRecipe(row.recipe_id) : null;
    if (recipe) lines.push(...ingredientLines(recipe, row.portions ?? 1));
  }
  for (const prep of prepRows(plan.id)) {
    if (prep.status !== "planned" || prep.cook_date < from || prep.cook_date > to) continue;
    const recipe = findRecipe(prep.recipe_id);
    if (recipe) lines.push(...ingredientLines(recipe, prep.portions));
  }
  return lines;
}
