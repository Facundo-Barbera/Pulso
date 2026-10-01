/**
 * The dated plan's rows: slots (date × meal), the per-date marker that says a
 * date was laid out from the rotation, and the links from log entries to the
 * slot they ate or replaced. Low level on purpose: the store's meal log calls
 * into it, so it must not import the store. Views and changes live in
 * horizon.ts and ops.ts.
 */
import { randomUUID } from "node:crypto";
import { MEAL_SLOTS, type DietPlan, type MealEntry, type MealSlot, type PlanItem, type SlotKind } from "@pulso/contract";
import { db } from "../db";
import type { Line } from "../shopping/aggregate";
import { addDays, daysBetween } from "./dates";
import { findRecipe, ingredientLines } from "./recipes";

/** How many days the plan is laid out ahead when nobody asked for another length. */
export const DEFAULT_HORIZON_DAYS = 14;

export type StoredStatus = "planned" | "skipped" | "replaced";

export type SlotRow = {
  id: string;
  plan_id: string;
  date: string;
  slot: MealSlot;
  position: number;
  kind: SlotKind;
  name: string | null;
  recipe_id: string | null;
  prep_id: string | null;
  portions: number | null;
  items_json: string;
  status: StoredStatus;
  note: string | null;
  updated_at: number;
};

export type DayRow = { plan_id: string; date: string; label: string; shift_kcal: number };
export type LinkRow = { entry_id: string; slot_id: string; role: "planned" | "replacement" };

export const itemsOf = (row: Pick<SlotRow, "items_json">): PlanItem[] => JSON.parse(row.items_json) as PlanItem[];
export const slotOrder = (slot: MealSlot) => MEAL_SLOTS.indexOf(slot);
const byMeal = (a: SlotRow, b: SlotRow) => a.date.localeCompare(b.date) || slotOrder(a.slot) - slotOrder(b.slot) || a.position - b.position;

/** Which plan day applies on `date`: days cycle from `startsOn`. */
export function planDayIndex(plan: Pick<DietPlan, "startsOn" | "days">, date: string): number {
  const n = plan.days.length;
  return ((daysBetween(plan.startsOn, date) % n) + n) % n;
}

export function horizonDays(planId: string): number {
  return db().query<{ days: number }, [string]>("SELECT days FROM plan_horizons WHERE plan_id = ?").get(planId)?.days ?? DEFAULT_HORIZON_DAYS;
}

export function setHorizonDays(planId: string, days: number): void {
  db().query("INSERT INTO plan_horizons (plan_id, days) VALUES (?, ?) ON CONFLICT (plan_id) DO UPDATE SET days = excluded.days").run(planId, days);
}

export function dayRow(planId: string, date: string): DayRow | null {
  return db().query<DayRow, [string, string]>("SELECT * FROM plan_days WHERE plan_id = ? AND date = ?").get(planId, date);
}

/**
 * Lays `date` out from the plan's rotation, once: each planned meal becomes an
 * item-list slot keeping the plan's item ids (so ticks and old adjustments
 * still match). Idempotent; a date already laid out is left alone.
 */
export function materialize(plan: DietPlan, date: string): void {
  if (dayRow(plan.id, date)) return;
  const day = plan.days[planDayIndex(plan, date)]!;
  db().transaction(() => {
    db().query("INSERT INTO plan_days (plan_id, date, label, shift_kcal) VALUES (?, ?, ?, 0)").run(plan.id, date, day.label);
    day.meals.forEach((meal, position) => {
      insertSlot({ plan_id: plan.id, date, slot: meal.slot, position, kind: "items", name: meal.name, recipe_id: null, prep_id: null, portions: null, items: meal.items, status: "planned", note: null });
    });
  })();
}

export function materializeRange(plan: DietPlan, from: string, to: string): void {
  for (let i = 0; i <= daysBetween(from, to); i++) materialize(plan, addDays(from, i));
}

export function slotRows(planId: string, from: string, to = from): SlotRow[] {
  return db().query<SlotRow, [string, string, string]>("SELECT * FROM plan_slots WHERE plan_id = ? AND date BETWEEN ? AND ?").all(planId, from, to).sort(byMeal);
}

export function findSlotRow(id: string): SlotRow | null {
  return db().query<SlotRow, [string]>("SELECT * FROM plan_slots WHERE id = ?").get(id);
}

export type NewSlot = Omit<SlotRow, "id" | "items_json" | "updated_at"> & { id?: string; items: PlanItem[] };

export function insertSlot(slot: NewSlot): string {
  const id = slot.id ?? randomUUID();
  db()
    .query(
      `INSERT INTO plan_slots (id, plan_id, date, slot, position, kind, name, recipe_id, prep_id, portions, items_json, status, note, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, slot.plan_id, slot.date, slot.slot, slot.position, slot.kind, slot.name, slot.recipe_id, slot.prep_id, slot.portions, JSON.stringify(slot.items), slot.status, slot.note, Date.now());
  return id;
}

export type SlotFields = Partial<Pick<SlotRow, "date" | "slot" | "position" | "kind" | "name" | "recipe_id" | "prep_id" | "portions" | "status" | "note">> & { items?: PlanItem[] };

export function updateSlot(id: string, fields: SlotFields): void {
  const row = findSlotRow(id);
  if (!row) return;
  const next = { ...row, ...fields, items_json: fields.items ? JSON.stringify(fields.items) : row.items_json };
  db()
    .query(
      `UPDATE plan_slots SET date = ?, slot = ?, position = ?, kind = ?, name = ?, recipe_id = ?, prep_id = ?, portions = ?, items_json = ?, status = ?, note = ?, updated_at = ? WHERE id = ?`,
    )
    .run(next.date, next.slot, next.position, next.kind, next.name, next.recipe_id, next.prep_id, next.portions, next.items_json, next.status, next.note, Date.now(), id);
}

export function nextPosition(planId: string, date: string): number {
  return (db().query<{ p: number | null }, [string, string]>("SELECT max(position) AS p FROM plan_slots WHERE plan_id = ? AND date = ?").get(planId, date)?.p ?? -1) + 1;
}

export function setShift(planId: string, date: string, kcal: number): void {
  db().query("UPDATE plan_days SET shift_kcal = ? WHERE plan_id = ? AND date = ?").run(Math.round(kcal), planId, date);
}

// --- Links from the meal log ---

export function linksOf(slotIds: string[]): LinkRow[] {
  if (!slotIds.length) return [];
  return db()
    .query<LinkRow, string[]>(`SELECT * FROM meal_slot_links WHERE slot_id IN (${slotIds.map(() => "?").join(",")})`)
    .all(...slotIds);
}

/** The active plan's slot on `date` holding plan item `itemId`. */
export function slotWithItem(date: string, itemId: string): SlotRow | null {
  const rows = db()
    .query<SlotRow, [string]>("SELECT s.* FROM plan_slots s JOIN diet_plans p ON p.id = s.plan_id AND p.active = 1 WHERE s.date = ?")
    .all(date);
  return rows.find((r) => itemsOf(r).some((i) => i.id === itemId)) ?? null;
}

/** What eating `entry` as planned from `slot` uses up: the item itself, or its share of a recipe cooked that day. Batch portions were used up when cooked. */
export function eatenLines(entry: Pick<MealEntry, "name" | "quantity" | "unit">, slot: SlotRow): Line[] {
  if (slot.kind === "items") return [{ name: entry.name, quantity: entry.quantity, unit: entry.unit }];
  if (slot.kind !== "recipe" || !slot.recipe_id) return [];
  const recipe = findRecipe(slot.recipe_id);
  return recipe ? ingredientLines(recipe, entry.unit === "serving" ? entry.quantity : (slot.portions ?? 1)) : [];
}
