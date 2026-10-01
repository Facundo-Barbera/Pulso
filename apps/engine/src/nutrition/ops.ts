/**
 * Local changes to the dated plan. Each one touches only the slots it names,
 * records a revision (undo puts it back) and returns a Spanish line saying
 * what changed. Nothing here regenerates the plan: that is create_diet_plan,
 * only when the person asks for a new one.
 */
import { randomUUID } from "node:crypto";
import type { Compensation, DietPlan, PantryItem, PlanChange, PlanItem, PlanSlot, Recipe } from "@pulso/contract";
import { db } from "../db";
import { nameKey } from "../shopping/aggregate";
import { consume, pantryAlternatives } from "../shopping/pantry";
import { refreshShoppingList } from "../shopping/store";
import { adjustDayPlan, SLOT_TITLES, type AdjustResult } from "./adjust";
import { addDays, daysBetween, localDate } from "./dates";
import { PlanError, prepView, requirePlan, slotViews, statusOf } from "./horizon";
import { MACRO_KEYS, round, sum } from "./macros";
import type { Fill, OpInput } from "./plan-inputs";
import { createRecipe, dishItem, getPrepRow, getRecipe, ingredientLines, insertPrep, updatePrep } from "./recipes";
import { tie, untie } from "./reconcile";
import { revise, undoRevision } from "./revisions";
import {
  dayRow,
  findSlotRow,
  horizonDays,
  insertSlot,
  itemsOf,
  linksOf,
  materializeRange,
  nextPosition,
  setShift,
  slotRows,
  updateSlot,
  type SlotFields,
  type SlotRow,
} from "./slots";
import { getAdjustment, getTargets, listMeals, plannedDay } from "./store";

// --- Words ---

const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
export const dayName = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;
/** "mar 6" */
export const dayLabel = (date: string) => `${dayName(date)} ${Number(date.slice(8))}`;
const n = (value: number) => Math.round(value).toLocaleString("es-ES");
const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${n(Math.abs(value))}`;
export function listWords(words: string[]): string {
  return words.length < 2 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} y ${words.at(-1)}`;
}
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const portionsText = (p: number) => `${p === 1 ? "1 ración" : `${String(p).replace(".", ",")} raciones`}`;

function contents(row: Pick<SlotRow, "kind" | "name" | "portions" | "items_json">): string {
  if (row.kind === "eat_out") return lower(row.name ?? "comer fuera");
  if (row.name) return lower(row.name);
  return listWords(itemsOf(row).map((i) => lower(i.name)));
}

const where = (row: Pick<SlotRow, "slot" | "date">) => `${SLOT_TITLES[row.slot]} del ${dayLabel(row.date)}`;

// --- Finding slots ---

function slotsOn(plan: DietPlan, date: string): SlotRow[] {
  materializeRange(plan, date, date);
  return slotRows(plan.id, date);
}

/** The slot a change is about: by id, or the first still-planned one of that meal on that day. */
function resolveSlot(plan: DietPlan, input: { date?: string; slot?: SlotRow["slot"]; slotId?: string }, allowDone = false): SlotRow {
  if (input.slotId) {
    const row = findSlotRow(input.slotId);
    if (!row || row.plan_id !== plan.id) throw new PlanError(`No slot ${input.slotId} in the active plan.`);
    return row;
  }
  if (!input.slot) throw new PlanError("Say which meal: slot (desayuno, comida…) or slotId.");
  const date = input.date ?? localDate();
  const rows = slotsOn(plan, date).filter((r) => r.slot === input.slot);
  const links = linksOf(rows.map((r) => r.id));
  const open = rows.find((r) => statusOf(r, links) === "planned");
  const row = open ?? (allowDone ? rows[0] : undefined);
  if (!row) throw new PlanError(rows.length ? `The ${input.slot} of ${date} is already eaten, skipped or replaced.` : `The plan has no ${input.slot} on ${date}: use fill to add one.`);
  return row;
}

const isOpen = (row: SlotRow) => statusOf(row, linksOf([row.id])) === "planned";
const slotKcal = (row: SlotRow) => sum(itemsOf(row)).kcal;

// --- Fills ---

function fillFields(fill: Fill): SlotFields {
  switch (fill.kind) {
    case "items":
      return { kind: "items", name: fill.name ?? null, recipe_id: null, prep_id: null, portions: null, items: fill.items.map((i) => ({ ...i, id: randomUUID() })) };
    case "recipe": {
      const recipe = getRecipe(fill.recipeId);
      return { kind: "recipe", name: recipe.name, recipe_id: recipe.id, prep_id: null, portions: fill.portions, items: [dishItem(recipe, fill.portions)] };
    }
    case "prep": {
      const prep = getPrepRow(fill.prepId);
      const recipe = getRecipe(prep.recipe_id);
      return { kind: "prep", name: recipe.name, recipe_id: recipe.id, prep_id: prep.id, portions: fill.portions, items: [dishItem(recipe, fill.portions)] };
    }
    case "eat_out": {
      const name = fill.name?.trim() || "Comer fuera";
      const budget = round({ kcal: fill.kcal, protein: fill.protein, carbs: fill.carbs, fat: fill.fat, fiber: fill.fiber });
      return { kind: "eat_out", name, recipe_id: null, prep_id: null, portions: null, items: [{ id: randomUUID(), name: `${name} (presupuesto)`, quantity: 1, unit: "serving", ...budget }] };
    }
  }
}

const fillText = (f: SlotFields) => contents({ kind: f.kind!, name: f.name ?? null, portions: f.portions ?? null, items_json: JSON.stringify(f.items ?? []) });

/** What a slot holds, to move or swap it. */
const contentOf = (r: SlotRow): SlotFields => ({ kind: r.kind, name: r.name, recipe_id: r.recipe_id, prep_id: r.prep_id, portions: r.portions, items: itemsOf(r), note: r.note });

// --- Results ---

function change(plan: DietPlan, dates: string[], summary: string, revision: PlanChange["revision"], compensation: Compensation | null = null): PlanChange {
  const unique = [...new Set(dates)].sort();
  const slots: PlanSlot[] = unique.flatMap((d) => slotViews(slotRows(plan.id, d)));
  const shoppingRefreshed = refreshShoppingList();
  return { revision, summary, slots, compensation, shoppingRefreshed };
}

/** Re-lays the Coach's adjustment over dates whose meals changed underneath it. */
function refreshAdjustments(plan: DietPlan, dates: string[]): void {
  for (const date of new Set(dates)) {
    const existing = getAdjustment(date, plan.id);
    if (existing) adjustDayPlan(date, { note: existing.note, maxChangePct: 15 });
  }
}

// --- Compensation ---

type CompensateOptions = { compensate: "none" | "day" | "spread"; spreadDays: number; maxChangePct: number };

function goalOf(plan: DietPlan, date: string): number {
  return getTargets()?.kcal ?? sum(plannedDay(plan, date).meals.flatMap((m) => m.items)).kcal;
}

function absorbSameDay(plan: DietPlan, date: string, deviation: number, maxChangePct: number): Compensation {
  const base = plannedDay(plan, date);
  const result = adjustDayPlan(date, { maxChangePct, note: "Ajuste del resto del día" });
  const baseAhead = sum(result.meals.flatMap((m) => base.meals.find((b) => b.slot === m.slot)?.items ?? m.items)).kcal;
  const after = sum(result.meals.flatMap((m) => m.items)).kcal;
  const absorbed = Math.round(baseAhead - after);
  const unabsorbed = Math.round(deviation - absorbed);
  const rest = Math.abs(unabsorbed) > 50 && Math.sign(unabsorbed) === Math.sign(deviation) ? ` Quedan ${signed(unabsorbed)} kcal sin compensar.` : "";
  return { mode: "day", deviationKcal: Math.round(deviation), absorbedKcal: absorbed, unabsorbedKcal: unabsorbed, days: [], summary: result.summary + rest };
}

/** Moves `deviation` (kcal eaten over plan; negative = under) onto the next days, never more than maxChangePct of a day's goal each. */
export function spreadDeviation(plan: DietPlan, date: string, deviation: number, days: number, maxChangePct: number): Compensation {
  const dates = Array.from({ length: days }, (_, i) => addDays(date, i + 1));
  materializeRange(plan, dates[0]!, dates.at(-1)!);
  const share = deviation / days;
  const out: Compensation["days"] = [];
  let absorbed = 0;
  for (const d of dates) {
    const cap = (goalOf(plan, d) * maxChangePct) / 100;
    const current = dayRow(plan.id, d)?.shift_kcal ?? 0;
    const next = Math.round(Math.max(-cap, Math.min(cap, current - share)));
    if (next === current) continue;
    setShift(plan.id, d, next);
    absorbed += current - next;
    out.push({ date: d, shiftKcal: next - current });
    adjustDayPlan(d, { maxChangePct, note: deviation > 0 ? "Compensando unos días más ligeros" : "Recuperando lo que faltó" });
  }
  const unabsorbed = Math.round(deviation - absorbed);
  const each = out.length ? Math.round(out.reduce((t, x) => t + x.shiftKcal, 0) / out.length) : 0;
  const head = out.length
    ? `Reparto ${signed(Math.round(absorbed))} kcal en ${out.length === 1 ? "1 día" : `${out.length} días`}: ${signed(each)} kcal ${listWords(out.map((x) => dayLabel(x.date)))}.`
    : "No hay margen para repartirlo en los próximos días.";
  const rest = Math.abs(unabsorbed) > 50 ? ` El resto (${signed(unabsorbed)} kcal) no lo compenso: ningún día se mueve más de un ${maxChangePct} %.` : "";
  return { mode: "spread", deviationKcal: Math.round(deviation), absorbedKcal: Math.round(absorbed), unabsorbedKcal: unabsorbed, days: out, summary: head + rest };
}

function compensateFor(plan: DietPlan, date: string, deviation: number, options: CompensateOptions): Compensation {
  if (options.compensate === "day") return absorbSameDay(plan, date, deviation, options.maxChangePct);
  if (options.compensate === "spread") return spreadDeviation(plan, date, deviation, options.spreadDays, options.maxChangePct);
  return { mode: "none", deviationKcal: Math.round(deviation), absorbedKcal: 0, unabsorbedKcal: Math.round(deviation), days: [], summary: "" };
}

const compensationDates = (date: string, options: CompensateOptions) =>
  options.compensate === "spread" ? Array.from({ length: options.spreadDays }, (_, i) => addDays(date, i + 1)) : [];

// --- Operations ---

export function skipSlot(input: OpInput<"skip">): PlanChange {
  const plan = requirePlan();
  const row = resolveSlot(plan, input);
  const dates = [row.date, ...compensationDates(row.date, input)];
  materializeRange(plan, dates[0]!, dates.at(-1)!);
  const out = revise({ planId: plan.id, op: "skip", dates }, () => {
    const kcal = slotKcal(row);
    updateSlot(row.id, { status: "skipped", note: input.note ?? row.note });
    const compensation = compensateFor(plan, row.date, -kcal, input);
    const summary = `Saltaste ${where(row)} (${signed(-kcal)} kcal).${compensation.summary ? ` ${compensation.summary}` : ""}`;
    return { summary, compensation };
  });
  return change(plan, dates, out.summary, out.revision, out.compensation);
}

export function replaceSlot(input: OpInput<"replace">): PlanChange {
  const plan = requirePlan();
  const row = resolveSlot(plan, input, true);
  const dates = [row.date, ...compensationDates(row.date, input)];
  materializeRange(plan, dates[0]!, dates.at(-1)!);
  const entries = input.entryIds?.length ? listMeals(row.date).filter((e) => input.entryIds!.includes(e.id)) : [];
  if (input.entryIds && entries.length !== input.entryIds.length) throw new PlanError(`Some entryIds are not logged on ${row.date}.`);
  const out = revise({ planId: plan.id, op: "replace", dates }, () => {
    const planned = slotKcal(row);
    const eaten = sum(entries).kcal;
    // Entries reconciling tied elsewhere move here; the meal they leave settles.
    untie(entries.map((e) => e.id));
    tie(entries, row, true);
    const what = input.what ?? (entries.length ? listWords(entries.map((e) => e.name)) : "otra cosa");
    updateSlot(row.id, { status: "replaced", note: input.what ?? row.note });
    const deviation = entries.length ? eaten - planned : 0;
    const compensation = compensateFor(plan, row.date, deviation, input);
    const diff = entries.length ? ` (${signed(deviation)} kcal)` : "";
    const summary = `${capitalize(where(row))}: ${lower(what)} en vez de ${contents(row)}${diff}.${compensation.summary ? ` ${compensation.summary}` : ""}`;
    return { summary, compensation };
  });
  return change(plan, dates, out.summary, out.revision, out.compensation);
}

/** Restaurants serve more than a home plate: with no estimate, eating out counts as the planned meal plus this. */
const EAT_OUT_FACTOR = 1.3;

/**
 * «Comí fuera»: logs an estimate of what was eaten out (given, else the
 * planned meal × 1.3) as the real meal of that slot. Undo deletes the estimate.
 */
export function ateOut(input: OpInput<"ate_out">): PlanChange {
  const plan = requirePlan();
  const row = resolveSlot(plan, input, true);
  if (linksOf([row.id]).length) throw new PlanError(`The ${row.slot} of ${row.date} already has what was eaten: delete it or use place first.`);
  const dates = [row.date, ...compensationDates(row.date, input)];
  materializeRange(plan, dates[0]!, dates.at(-1)!);
  const planned = sum(itemsOf(row));
  const given = input.kcal !== undefined;
  const macros = given
    ? round({ kcal: input.kcal!, protein: input.protein ?? 0, carbs: input.carbs ?? 0, fat: input.fat ?? 0, fiber: input.fiber ?? 0 })
    : round(Object.fromEntries(MACRO_KEYS.map((k) => [k, planned[k] * EAT_OUT_FACTOR])) as typeof planned);
  const name = input.name?.trim() || "Comida fuera";
  const out = revise({ planId: plan.id, op: "ate_out", dates }, () => {
    const at = input.eatenAt ?? (row.date === localDate() ? Date.now() : Date.parse(`${row.date}T12:00:00`));
    const id = randomUUID();
    db()
      .query(
        `INSERT INTO meal_entries (id, date, eaten_at, slot, name, quantity, unit, kcal, protein, carbs, fat, fiber, source, barcode, plan_item_id)
         VALUES (?, ?, ?, ?, ?, 1, 'serving', ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      )
      .run(id, row.date, Math.round(at), row.slot, name, macros.kcal, macros.protein, macros.carbs, macros.fat, macros.fiber, "manual");
    db().query("INSERT INTO meal_entry_context (entry_id, off_plan, note) VALUES (?, 1, ?)").run(id, input.note ?? (given ? null : "Estimación"));
    db().query("INSERT INTO meal_slot_links (entry_id, slot_id, role) VALUES (?, ?, 'replacement')").run(id, row.id);
    updateSlot(row.id, { status: "replaced" });
    const deviation = macros.kcal - planned.kcal;
    const compensation = compensateFor(plan, row.date, deviation, input);
    const estimate = given ? "" : ", estimado";
    const summary = `${capitalize(where(row))}: comiste fuera en vez de ${contents(row)} (${n(macros.kcal)} kcal${estimate}, ${signed(deviation)} kcal).${compensation.summary ? ` ${compensation.summary}` : ""}`;
    return { summary, compensation, logged: [id] };
  });
  return change(plan, dates, out.summary, out.revision, out.compensation);
}

/**
 * «Eso fue mi desayuno» / «eso fue un snack»: ties logged entries to another
 * meal, or makes them extras that reconciling leaves alone.
 */
export function placeEntries(input: OpInput<"place">): PlanChange {
  const plan = requirePlan();
  const found = input.entryIds.map((id) => db().query<{ date: string }, [string]>("SELECT date FROM meal_entries WHERE id = ?").get(id));
  if (found.some((f) => !f)) throw new PlanError("Some entryIds are not logged.");
  const date = found[0]!.date;
  const entries = listMeals(date).filter((e) => input.entryIds.includes(e.id));
  if (entries.length !== input.entryIds.length) throw new PlanError("Place entries of one day at a time.");
  const target = input.extra ? null : resolveSlot(plan, { date, slot: input.slot, slotId: input.slotId }, true);
  if (!input.extra && !target) throw new PlanError("Say which meal (slot or slotId), or extra: true.");
  const out = revise({ planId: plan.id, op: "place", dates: [date] }, () => {
    const what = lower(listWords(entries.map((e) => e.name)));
    untie(entries.map((e) => e.id));
    if (!target) {
      for (const e of entries) db().query("INSERT OR REPLACE INTO meal_entry_pins (entry_id, pin) VALUES (?, 'extra')").run(e.id);
      return { summary: `${capitalize(what)} queda como extra del ${dayLabel(date)}.` };
    }
    tie(entries, target);
    const article = target.slot === "desayuno" || target.slot === "snack" ? "el" : "la";
    return { summary: `${capitalize(what)} pasa a ser ${article} ${where(target)} (en vez de ${contents(target)}).` };
  });
  return change(plan, [date], out.summary, out.revision);
}

export function rebalanceDay(input: OpInput<"rebalance">): PlanChange & { adjustment: AdjustResult } {
  const plan = requirePlan();
  const date = input.date ?? localDate();
  materializeRange(plan, date, date);
  const out = revise({ planId: plan.id, op: "rebalance", dates: [date] }, () => {
    const { date: _date, ...options } = input;
    const adjustment = adjustDayPlan(date, options);
    return { summary: adjustment.summary, adjustment };
  });
  return { ...change(plan, [date], out.summary, out.revision), adjustment: out.adjustment };
}

export function spread(input: OpInput<"spread">): PlanChange {
  const plan = requirePlan();
  const date = input.date ?? localDate();
  const dates = Array.from({ length: input.days }, (_, i) => addDays(date, i + 1));
  materializeRange(plan, dates[0]!, dates.at(-1)!);
  const out = revise({ planId: plan.id, op: "spread", dates }, () => {
    const compensation = spreadDeviation(plan, date, input.kcal, input.days, input.maxChangePct);
    return { summary: compensation.summary, compensation };
  });
  return change(plan, dates, out.summary, out.revision, out.compensation);
}

// --- Ingredient unavailable ---

/** "salmon" matches "Salmón a la plancha" and "Lomo de salmón", not "Salmonete". */
const mentions = (name: string, wanted: string) => ` ${nameKey(name)} `.includes(` ${wanted} `);

export type UnavailablePreview = { preview: true; ingredient: string; summary: string; affected: PlanSlot[]; alternatives: PantryItem[] };

function substituted<T extends PlanItem | Recipe["ingredients"][number]>(item: T, sub: NonNullable<OpInput<"ingredient_unavailable">["substitute"]>): T {
  const quantity = Math.round(item.quantity * sub.ratio * 10) / 10;
  const per = item.unit === "g" || item.unit === "ml" ? quantity / 100 : quantity;
  const macros = round(Object.fromEntries(MACRO_KEYS.map((k) => [k, sub.per100[k] * per])) as Record<(typeof MACRO_KEYS)[number], number>);
  return { ...item, name: sub.name, quantity, ...macros };
}

export function ingredientUnavailable(input: OpInput<"ingredient_unavailable">): PlanChange | UnavailablePreview {
  const plan = requirePlan();
  const wanted = nameKey(input.ingredient);
  if (!wanted) throw new PlanError("Say which ingredient.");
  const from = input.from ?? localDate();
  const to = input.to ?? addDays(from, horizonDays(plan.id) - 1);
  if (to < from || daysBetween(from, to) > 60) throw new PlanError("from..to must be 1 to 61 days with from <= to.");
  materializeRange(plan, from, to);
  const rows = slotRows(plan.id, from, to);
  const links = linksOf(rows.map((r) => r.id));
  const recipeHas = (id: string | null) => (id ? getRecipe(id).ingredients.some((i) => mentions(i.name, wanted)) : false);
  const affected = rows.filter((r) => {
    if (statusOf(r, links) !== "planned") return false;
    if (r.kind === "items") return itemsOf(r).some((i) => mentions(i.name, wanted));
    if (r.kind === "recipe") return recipeHas(r.recipe_id);
    // A batch already cooked has what it has.
    if (r.kind === "prep" && r.prep_id) return getPrepRow(r.prep_id).status === "planned" && recipeHas(r.recipe_id);
    return false;
  });
  if (!input.substitute) {
    const alternatives = pantryAlternatives(input.ingredient);
    const days = [...new Set(affected.map((r) => dayLabel(r.date)))];
    const summary = affected.length
      ? `${capitalize(input.ingredient)} aparece en ${affected.length === 1 ? "1 comida" : `${affected.length} comidas`} (${listWords(days)}).`
      : `${capitalize(input.ingredient)} no aparece en lo que queda del plan.`;
    return { preview: true, ingredient: input.ingredient, summary, affected: slotViews(affected), alternatives };
  }
  if (!affected.length) throw new PlanError(`${input.ingredient} is not in any planned meal from ${from} to ${to}.`);
  const sub = input.substitute;
  const prepIds = [...new Set(affected.map((r) => r.prep_id).filter((id): id is string => id !== null))];
  const dates = affected.map((r) => r.date);
  const out = revise({ planId: plan.id, op: "ingredient_unavailable", dates, prepIds }, () => {
    const variants = new Map<string, Recipe>();
    const variantOf = (recipeId: string) => {
      if (!variants.has(recipeId)) {
        const r = getRecipe(recipeId);
        const ingredients = r.ingredients.map((i) => (mentions(i.name, wanted) ? substituted(i, sub) : i));
        variants.set(recipeId, createRecipe({ name: `${r.name} (con ${lower(sub.name)})`, servings: r.servings, prepMinutes: r.prepMinutes, batch: r.batch, ingredients, steps: r.steps }, r.id));
      }
      return variants.get(recipeId)!;
    };
    for (const r of affected) {
      if (r.kind === "items") {
        updateSlot(r.id, { items: itemsOf(r).map((i) => (mentions(i.name, wanted) ? { ...substituted(i, sub), id: randomUUID() } : i)) });
        continue;
      }
      const recipe = variantOf(r.recipe_id!);
      updateSlot(r.id, { recipe_id: recipe.id, name: recipe.name, items: [dishItem(recipe, r.portions ?? 1)] });
    }
    for (const id of prepIds) {
      const prep = getPrepRow(id);
      const recipe = variantOf(prep.recipe_id);
      updatePrep(id, { recipe_id: recipe.id });
      // Every portion of the batch changes, also those outside the range.
      const portions = db().query<SlotRow, [string]>("SELECT * FROM plan_slots WHERE prep_id = ?").all(id);
      for (const r of portions) updateSlot(r.id, { recipe_id: recipe.id, name: recipe.name, items: [dishItem(recipe, r.portions ?? 1)] });
    }
    refreshAdjustments(plan, dates);
    const days = [...new Set(affected.map((r) => r.date))].sort().map(dayName);
    const count = affected.length === 1 ? "1 comida" : `${affected.length} comidas`;
    return { summary: `Cambié ${lower(input.ingredient)} por ${lower(sub.name)} en ${count} (${listWords(days)}).` };
  });
  return change(plan, dates, out.summary, out.revision);
}

// --- No time to cook ---

const QUICK_MINUTES = 15;

function needsCooking(row: SlotRow): boolean {
  if (row.kind !== "recipe" || !row.recipe_id) return false;
  return getRecipe(row.recipe_id).prepMinutes > QUICK_MINUTES;
}

/** Batches cooked (or to be cooked) by `date`, cooked ones first, with their free portions. */
const slotFreeBatches = (plan: DietPlan, date: string) =>
  db()
    .query<{ id: string }, [string, string]>("SELECT id FROM prep_batches WHERE plan_id = ? AND status != 'discarded' AND cook_date <= ? ORDER BY status = 'cooked' DESC, cook_date")
    .all(plan.id, date)
    .map((r) => prepView(getPrepRow(r.id)));

export function noTimeToCook(input: OpInput<"no_time_to_cook">): PlanChange {
  const plan = requirePlan();
  const date = input.date ?? localDate();
  const day = slotsOn(plan, date).filter(isOpen);
  const targets = input.slot ? day.filter((r) => r.slot === input.slot) : day.filter(needsCooking);
  if (!targets.length) throw new PlanError(input.slot ? `No planned ${input.slot} on ${date}.` : `Nothing on ${date} needs more than ${QUICK_MINUTES} min of cooking: pass slot.`);
  const end = addDays(date, horizonDays(plan.id));

  type Step = { row: SlotRow; how: "leftover"; prepId: string } | { row: SlotRow; how: "move"; other: SlotRow } | { row: SlotRow; how: "quick"; fill: Fill };
  const steps: Step[] = [];
  const reserved = new Map<string, number>();
  for (const row of targets) {
    const portions = row.portions ?? 1;
    const tryLeftover = input.strategy === "leftover" || input.strategy === "auto";
    const tryMove = input.strategy === "move" || input.strategy === "auto";
    if (tryLeftover) {
      const batch = slotFreeBatches(plan, date).find((p) => p.leftover - (reserved.get(p.id) ?? 0) >= portions && p.id !== row.prep_id);
      if (batch) {
        reserved.set(batch.id, (reserved.get(batch.id) ?? 0) + portions);
        steps.push({ row, how: "leftover", prepId: batch.id });
        continue;
      }
    }
    if (tryMove) {
      materializeRange(plan, addDays(date, 1), end);
      const later = input.toDate
        ? slotsOn(plan, input.toDate).filter((r) => r.slot === row.slot && isOpen(r))
        : slotRows(plan.id, addDays(date, 1), end).filter((r) => r.slot === row.slot && isOpen(r) && !needsCooking(r) && !steps.some((s) => s.how === "move" && s.other.id === r.id));
      if (later[0]) {
        steps.push({ row, how: "move", other: later[0] });
        continue;
      }
    }
    if (input.strategy === "quick" || input.quick) {
      if (!input.quick) throw new PlanError("strategy quick needs `quick`: what to eat instead.");
      steps.push({ row, how: "quick", fill: input.quick });
      continue;
    }
    throw new PlanError(`No batch portion free and no later ${row.slot} without cooking: pass strategy quick with what to eat.`);
  }

  const dates = [date, ...steps.flatMap((s) => (s.how === "move" ? [s.other.date] : []))];
  const prepIds = steps.flatMap((s) => (s.how === "leftover" ? [s.prepId] : []));
  const out = revise({ planId: plan.id, op: "no_time_to_cook", dates, prepIds }, () => {
    const lines: string[] = [];
    for (const step of steps) {
      const was = contents(step.row);
      if (step.how === "leftover") {
        const fields = fillFields({ kind: "prep", prepId: step.prepId, portions: step.row.portions ?? 1 });
        updateSlot(step.row.id, fields);
        lines.push(`${capitalize(where(step.row))}: ${fillText(fields)} del batch del ${dayLabel(getPrepRow(step.prepId).cook_date)} en vez de ${was}`);
      } else if (step.how === "move") {
        const mine = contentOf(step.row);
        updateSlot(step.row.id, contentOf(step.other));
        updateSlot(step.other.id, mine);
        lines.push(`${capitalize(where(step.row))}: ${contents(step.other)}; ${was} pasa al ${dayLabel(step.other.date)}`);
      } else {
        const fields = fillFields(step.fill);
        updateSlot(step.row.id, fields);
        lines.push(`${capitalize(where(step.row))}: ${fillText(fields)} en vez de ${was}`);
      }
    }
    refreshAdjustments(plan, dates);
    return { summary: `${lines.join(". ")}.` };
  });
  return change(plan, dates, out.summary, out.revision);
}

// --- Moving things around ---

export function moveSlot(input: OpInput<"move">): PlanChange {
  const plan = requirePlan();
  const row = resolveSlot(plan, input);
  const toSlot = input.toSlot ?? row.slot;
  if (row.date === input.toDate && toSlot === row.slot) throw new PlanError("It is already there.");
  const target = slotsOn(plan, input.toDate).find((r) => r.slot === toSlot && isOpen(r));
  const dates = [row.date, input.toDate];
  const out = revise({ planId: plan.id, op: "move", dates }, () => {
    if (target) {
      const mine = contentOf(row);
      updateSlot(row.id, contentOf(target));
      updateSlot(target.id, mine);
    } else {
      updateSlot(row.id, { date: input.toDate, slot: toSlot, position: nextPosition(plan.id, input.toDate) });
    }
    refreshAdjustments(plan, dates);
    const to = `${SLOT_TITLES[toSlot]} del ${dayLabel(input.toDate)}`;
    return {
      summary: target
        ? `Cambié ${where(row)} (${contents(row)}) por ${to} (${contents(target)}).`
        : `Moví ${contents(row)} de ${where(row)} a ${to}.`,
    };
  });
  return change(plan, dates, out.summary, out.revision);
}

export function swapDays(input: OpInput<"swap_days">): PlanChange {
  const plan = requirePlan();
  if (input.a === input.b) throw new PlanError("Pick two different days.");
  const [a, b] = [slotsOn(plan, input.a).filter(isOpen), slotsOn(plan, input.b).filter(isOpen)];
  const dates = [input.a, input.b];
  const out = revise({ planId: plan.id, op: "swap_days", dates }, () => {
    for (const r of a) updateSlot(r.id, { date: input.b });
    for (const r of b) updateSlot(r.id, { date: input.a });
    const [la, lb] = [dayRow(plan.id, input.a)!.label, dayRow(plan.id, input.b)!.label];
    db().query("UPDATE plan_days SET label = ? WHERE plan_id = ? AND date = ?").run(lb, plan.id, input.a);
    db().query("UPDATE plan_days SET label = ? WHERE plan_id = ? AND date = ?").run(la, plan.id, input.b);
    refreshAdjustments(plan, dates);
    return { summary: `Cambié el menú del ${dayLabel(input.a)} por el del ${dayLabel(input.b)} (${a.length + b.length} comidas).` };
  });
  return change(plan, dates, out.summary, out.revision);
}

export function fillSlot(input: OpInput<"fill">): PlanChange {
  const plan = requirePlan();
  const date = input.date ?? localDate();
  const existing = input.slotId || input.slot ? slotsOn(plan, date).find((r) => (input.slotId ? r.id === input.slotId : r.slot === input.slot && isOpen(r))) : undefined;
  if (!existing && !input.slot) throw new PlanError("Say which meal: slot or slotId.");
  if (input.fill.kind === "prep") {
    const batch = prepView(getPrepRow(input.fill.prepId));
    const mine = existing?.prep_id === batch.id ? (existing.portions ?? 1) : 0;
    if (batch.leftover + mine < input.fill.portions) throw new PlanError(`That batch has ${batch.leftover} portion(s) free.`);
  }
  const prepIds = input.fill.kind === "prep" ? [input.fill.prepId] : [];
  const out = revise({ planId: plan.id, op: "fill", dates: [date], prepIds }, () => {
    const fields = { ...fillFields(input.fill), note: input.note ?? null };
    if (existing) updateSlot(existing.id, fields);
    else {
      insertSlot({
        plan_id: plan.id, date, slot: input.slot!, position: nextPosition(plan.id, date), kind: fields.kind!, name: fields.name ?? null,
        recipe_id: fields.recipe_id ?? null, prep_id: fields.prep_id ?? null, portions: fields.portions ?? null, items: fields.items!, status: "planned", note: fields.note ?? null,
      });
    }
    refreshAdjustments(plan, [date]);
    const at = `${SLOT_TITLES[input.slot ?? existing!.slot]} del ${dayLabel(date)}`;
    return { summary: existing ? `${capitalize(at)}: ${fillText(fields)} en vez de ${contents(existing)}.` : `Añadí ${at}: ${fillText(fields)}.` };
  });
  return change(plan, [date], out.summary, out.revision);
}

// --- Prep batches ---

export function schedulePrep(input: OpInput<"schedule_prep">): PlanChange {
  const plan = requirePlan();
  const recipe = getRecipe(input.recipeId);
  if (input.assign.length > input.portions) throw new PlanError(`${input.assign.length} slots for a batch of ${input.portions} portions.`);
  if (input.assign.some((a) => a.date < input.cookDate)) throw new PlanError("A portion can't be eaten before the batch is cooked.");
  const dates = [input.cookDate, ...input.assign.map((a) => a.date)];
  for (const d of dates) slotsOn(plan, d);
  const id = randomUUID();
  const out = revise({ planId: plan.id, op: "schedule_prep", dates, prepIds: [id] }, () => {
    insertPrep(plan.id, recipe.id, input.cookDate, input.portions, id);
    const fields = fillFields({ kind: "prep", prepId: id, portions: 1 });
    for (const a of input.assign) {
      const row = slotRows(plan.id, a.date).find((r) => r.slot === a.slot && isOpen(r));
      if (row) updateSlot(row.id, fields);
      else {
        insertSlot({ plan_id: plan.id, date: a.date, slot: a.slot, position: nextPosition(plan.id, a.date), kind: "prep", name: recipe.name, recipe_id: recipe.id, prep_id: id, portions: 1, items: [dishItem(recipe, 1)], status: "planned", note: null });
      }
    }
    refreshAdjustments(plan, dates);
    const slots = input.assign.map((a) => `${SLOT_TITLES[a.slot]} ${dayName(a.date)}`);
    const rest = input.portions - input.assign.length;
    const tail = slots.length ? `: ${input.assign.length === 1 ? "1 ración" : `${input.assign.length} raciones`} para ${listWords(slots)}` : "";
    return { summary: `Batch de ${lower(recipe.name)} el ${dayLabel(input.cookDate)} (${portionsText(input.portions)})${tail}${rest > 0 ? `; ${rest} de sobra` : ""}.` };
  });
  return change(plan, dates, out.summary, out.revision);
}

export function prepCooked(input: OpInput<"prep_cooked">): PlanChange {
  const plan = requirePlan();
  const prep = getPrepRow(input.prepId);
  if (prep.plan_id !== plan.id) throw new PlanError("That batch belongs to an older plan.");
  const recipe = getRecipe(prep.recipe_id);
  const out = revise({ planId: plan.id, op: "prep_cooked", dates: [prep.cook_date], prepIds: [prep.id], pantry: true }, () => {
    if (input.cooked) {
      if (prep.status !== "cooked") consume(ingredientLines(recipe, prep.portions));
      updatePrep(prep.id, { status: "cooked", cooked_at: Date.now() });
      return { summary: `Batch de ${lower(recipe.name)} cocinado: ${portionsText(prep.portions)}.` };
    }
    updatePrep(prep.id, { status: "planned", cooked_at: null });
    return { summary: `El batch de ${lower(recipe.name)} vuelve a estar por cocinar.` };
  });
  return change(plan, [prep.cook_date], out.summary, out.revision);
}

export function useLeftover(input: OpInput<"use_leftover">): PlanChange {
  const plan = requirePlan();
  const batch = prepView(getPrepRow(input.prepId));
  if (batch.leftover < 1) throw new PlanError(`No portion of ${batch.recipeName} is free: every one is assigned.`);
  if (input.date < batch.cookDate) throw new PlanError(`The batch is cooked on ${batch.cookDate}.`);
  return fillSlot({ date: input.date, slot: input.slot, fill: { kind: "prep", prepId: input.prepId, portions: 1 } });
}

export function undo(id?: string): PlanChange {
  const plan = requirePlan();
  const revision = undoRevision(plan.id, id);
  return change(plan, revision.dates, `Deshecho: ${lower(revision.summary)}`, revision);
}

/** The op name a route body or a tool picks → its function. */
export const OPS = {
  skip: skipSlot,
  replace: replaceSlot,
  ate_out: ateOut,
  place: placeEntries,
  rebalance: rebalanceDay,
  spread,
  ingredient_unavailable: ingredientUnavailable,
  no_time_to_cook: noTimeToCook,
  move: moveSlot,
  swap_days: swapDays,
  fill: fillSlot,
  schedule_prep: schedulePrep,
  prep_cooked: prepCooked,
  use_leftover: useLeftover,
} as const;
