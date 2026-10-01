/** Logging dishes: a new one from its components, a saved one (scaled or tweaked), adding to one already logged, and saving one for next time. */
import type { LogDishOptions, MealEntry, MealInput, MealSlot, MealSource, SavedDish } from "@pulso/contract";
import { db } from "../db";
import { localDate } from "./dates";
import { component, dishEntryIds, dishName, dishPortion, DishError, getSavedDish, joinDish, loggedDish, recipeDish, renameLoggedDish, saveDish } from "./dishes";
import { mealClock, minuteOfDay, untie } from "./reconcile";
import { listMeals, logMeals } from "./store";

/** When and as what a dish is eaten. Slot defaults to the saved dish's, else the meal nearest the time. */
export type DishWhen = { eatenAt?: number; date?: string; slot?: MealSlot; slotId?: string | null; note?: string | null; offPlan?: boolean };

type Component = Omit<MealInput, "slot" | "eatenAt" | "date">;

/** The main meal whose usual time is nearest `ms` (snacks are never guessed). */
export function mealAt(ms: number): MealSlot {
  const clock = mealClock(localDate(ms));
  const minute = minuteOfDay(ms);
  const meals = (Object.keys(clock) as MealSlot[]).filter((s) => s !== "snack");
  return meals.reduce((a, b) => (Math.abs(clock[b] - minute) < Math.abs(clock[a] - minute) ? b : a));
}

function logAs(components: Component[], name: string, savedDishId: string | null, when: DishWhen, fallback: MealSlot | null, source: MealSource): MealEntry[] {
  const eatenAt = Math.round(when.eatenAt ?? Date.now());
  const slot = when.slot ?? fallback ?? mealAt(eatenAt);
  const meal = components.map((c) => ({ ...c, slot, eatenAt, date: when.date, slotId: when.slotId ?? null, offPlan: when.offPlan ?? false, note: when.note ?? c.note ?? null }));
  return logMeals(meal, source, { name, savedDishId });
}

/** Logs foods eaten together as one dish; without a name, one is made from the foods. */
export function logDish(components: Component[], name: string | null, when: DishWhen = {}, source: MealSource = "manual"): MealEntry[] {
  if (!components.length) throw new DishError("A dish needs at least one component.");
  return logAs(components, name?.trim() || dishName(components), null, when, null, source);
}

/** Logs a saved dish this time: scaled, with one-off changes, and with foods added just this once. */
export function logSavedDish(id: string, options: LogDishOptions & { add?: Component[] } = {}, when: DishWhen = {}, source: MealSource = "manual"): MealEntry[] {
  const dish = getSavedDish(id);
  const components = [...dishPortion(dish.components, options), ...(options.add ?? []).map(component)];
  return logAs(components, dish.name, dish.id, when, dish.slot, source);
}

/** The entries of a dish eaten, in order. */
export function dishEntries(dishId: string): MealEntry[] {
  const ids = dishEntryIds(dishId);
  const first = ids[0] && db().query<{ date: string }, [string]>("SELECT date FROM meal_entries WHERE id = ?").get(ids[0]);
  if (!first) throw new DishError(`No logged dish ${dishId}: list_meals shows each entry's dish.`);
  const byId = new Map(listMeals(first.date).map((e) => [e.id, e]));
  return ids.flatMap((i) => byId.get(i) ?? []);
}

/** Adds foods to a dish already logged ("le puse también fresas"): same time, meal and plan slot. */
export function addToDish(dishId: string, components: Component[], source: MealSource = "manual"): MealEntry[] {
  const [first] = dishEntries(dishId);
  if (!first) throw new DishError(`No logged dish ${dishId}.`);
  return db().transaction(() => {
    const added = logMeals(components.map((c) => ({ ...c, slot: first.slot, eatenAt: first.eatenAt, date: first.date, slotId: first.slotId })), source);
    // An extra dish stays an extra: what joins it is never a meal of its own.
    if (!first.slotId) untie(added.map((e) => e.id));
    joinDish(dishId, added.map((e) => e.id));
    return dishEntries(dishId);
  })();
}

export function renameDish(dishId: string, name: string): MealEntry[] {
  if (!renameLoggedDish(dishId, name)) throw new DishError(`No logged dish ${dishId}.`);
  return dishEntries(dishId);
}

/**
 * Saves a dish eaten as a saved dish (Guardar como platillo), as it was eaten
 * this time; the logged dish then counts as its first use.
 */
export function saveLoggedDish(dishId: string, name?: string | null, slot?: MealSlot | null): SavedDish {
  const dish = loggedDish(dishId);
  if (!dish) throw new DishError(`No logged dish ${dishId}.`);
  const entries = dishEntries(dishId);
  return db().transaction(() => {
    const saved = saveDish({ name: name?.trim() || dish.name, slot: slot === undefined ? (entries[0]!.slot === "snack" ? null : entries[0]!.slot) : slot, components: entries.map(component) });
    db().query("UPDATE meal_dishes SET saved_dish_id = ? WHERE id = ?").run(saved.id, dishId);
    return getSavedDish(saved.id);
  })();
}

/** Saves one portion of a plan recipe as a saved dish. */
export function saveRecipeAsDish(recipeId: string, name?: string | null, slot?: MealSlot | null): SavedDish {
  const fields = recipeDish(recipeId);
  return saveDish({ ...fields, name: name?.trim() || fields.name, slot: slot ?? null });
}
