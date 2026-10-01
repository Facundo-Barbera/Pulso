/**
 * Dishes (platillos). A dish eaten is a name over entries logged together as
 * its components (meal_dishes + meal_dish_components); a saved dish (Mis
 * platillos) is a template of components, logged in one tap, scaled or tweaked
 * this time only. Low level like slots.ts: the store's meal log calls into it,
 * so it must not import the store.
 */
import { randomUUID } from "node:crypto";
import type { DishComponent, LogDishOptions, MealInput, MealSlot, SavedDish } from "@pulso/contract";
import { HOUSEHOLD_SIZES } from "@pulso/contract";
import { db } from "../db";
import { pick, scale, sum } from "./macros";
import { parseMeasure, toQuantity } from "./measure";
import { findRecipe } from "./recipes";

export class DishError extends Error {}

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const round2 = (x: number) => Math.round(x * 100) / 100;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const listWords = (words: string[]) => (words.length < 2 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} y ${words.at(-1)}`);

// --- Names ---

const SHAKE = /\b(batido|licuado|smoothie|shake|whey|scoop)\b|proteina en polvo/;
const PROTEIN = /\b(whey|proteina|scoop)\b/;
const LIQUID_BASE = /^(leche|agua|bebida)\b/;

/** A food's name in a few words: no details in brackets, after a comma or with numbers ("Tortitas de carne de res 90/10 (air fryer)" → "Tortitas de carne"). */
function shortName(name: string, words: number): string {
  const plain = name.replace(/\([^)]*\)/g, " ").split(",")[0]!.split(/\s\+|\scon\s/)[0]!;
  const kept = plain.split(/\s+/).filter((w) => w && !/\d/.test(w));
  return kept.slice(0, kept[1] === "de" || kept[1] === "del" ? 3 : words).join(" ") || name.trim();
}

/**
 * A name for foods eaten together, when nobody gave one: the main food (most
 * kcal) with the rest in the order they were logged — "Tortitas de carne con
 * queso y arroz"; a shake reads "Batido de proteína con fresas".
 */
export function dishName(components: { name: string; kcal: number }[]): string {
  if (components.length === 1) return components[0]!.name;
  // Details in brackets don't count: "Fresas (en el batido)" is fruit, not the shake.
  const plain = (c: { name: string }) => fold(c.name.replace(/\([^)]*\)/g, " "));
  const shake = components.some((c) => SHAKE.test(plain(c)));
  const main = shake ? null : components.reduce((a, b) => (b.kcal > a.kcal ? b : a));
  const head = main ? shortName(main.name, 2) : components.some((c) => PROTEIN.test(plain(c))) ? "Batido de proteína" : "Batido";
  const rest = components
    .filter((c) => c !== main && !(shake && (SHAKE.test(plain(c)) || PROTEIN.test(plain(c)) || LIQUID_BASE.test(plain(c)))))
    .map((c) => lower(shortName(c.name, 1)));
  const others = [...new Set(rest)];
  if (!others.length) return head;
  return `${head} con ${others.length > 3 ? `${others.slice(0, 2).join(", ")} y más` : listWords(others)}`;
}

// --- Dishes eaten ---

/** Makes `entryIds` (in order) the components of a new dish eaten. */
export function attachDish(entryIds: string[], name: string, savedDishId: string | null = null): string {
  const id = randomUUID();
  db().query("INSERT INTO meal_dishes (id, name, saved_dish_id, created_at) VALUES (?, ?, ?, ?)").run(id, name.trim(), savedDishId, Date.now());
  entryIds.forEach((entryId, position) => {
    db().query("INSERT OR REPLACE INTO meal_dish_components (entry_id, dish_id, position) VALUES (?, ?, ?)").run(entryId, id, position);
  });
  return id;
}

/** Adds entries to a dish eaten: at `position` (taking an old component's place), else at the end. */
export function joinDish(dishId: string, entryIds: string[], position?: number): void {
  const next = position ?? (db().query<{ p: number | null }, [string]>("SELECT max(position) AS p FROM meal_dish_components WHERE dish_id = ?").get(dishId)?.p ?? -1) + 1;
  entryIds.forEach((entryId, i) => {
    db().query("INSERT OR REPLACE INTO meal_dish_components (entry_id, dish_id, position) VALUES (?, ?, ?)").run(entryId, dishId, next + i);
  });
}

export type LoggedDishRow = { id: string; name: string; saved_dish_id: string | null; created_at: number };

export function loggedDish(id: string): LoggedDishRow | null {
  return db().query<LoggedDishRow, [string]>("SELECT * FROM meal_dishes WHERE id = ?").get(id);
}

/** The entry ids of a dish eaten, in order. */
export function dishEntryIds(dishId: string): string[] {
  return db().query<{ entry_id: string }, [string]>("SELECT entry_id FROM meal_dish_components WHERE dish_id = ? ORDER BY position").all(dishId).map((r) => r.entry_id);
}

export function dishPosition(entryId: string): number | null {
  return db().query<{ position: number }, [string]>("SELECT position FROM meal_dish_components WHERE entry_id = ?").get(entryId)?.position ?? null;
}

export function renameLoggedDish(id: string, name: string): boolean {
  return db().query("UPDATE meal_dishes SET name = ? WHERE id = ?").run(name.trim(), id).changes > 0;
}

/** Dishes eaten whose components are all gone. */
export function dropEmptyDishes(): void {
  db().query("DELETE FROM meal_dishes WHERE NOT EXISTS (SELECT 1 FROM meal_dish_components c WHERE c.dish_id = meal_dishes.id)").run();
}

/** The dish name each entry is a component of (entries on their own are left out). */
export function dishNames(entryIds: string[]): Map<string, { dishId: string; name: string }> {
  if (!entryIds.length) return new Map();
  return new Map(
    db()
      .query<{ entry_id: string; dish_id: string; name: string }, string[]>(
        `SELECT c.entry_id, c.dish_id, d.name FROM meal_dish_components c JOIN meal_dishes d ON d.id = c.dish_id WHERE c.entry_id IN (${entryIds.map(() => "?").join(",")})`,
      )
      .all(...entryIds)
      .map((r) => [r.entry_id, { dishId: r.dish_id, name: r.name }]),
  );
}

/** What some entries were, one name per dish and per food on its own, in order. */
export function mealNames(entries: { id: string; name: string }[]): string[] {
  const dishes = dishNames(entries.map((e) => e.id));
  const seen = new Set<string>();
  return entries.flatMap((e) => {
    const dish = dishes.get(e.id);
    if (!dish) return [e.name];
    if (seen.has(dish.dishId)) return [];
    seen.add(dish.dishId);
    return [dish.name];
  });
}

// --- Saved dishes ---

type SavedRow = { id: string; name: string; slot: MealSlot | null; components_json: string; recipe_id: string | null; created_at: number; updated_at: number };
type UseRow = { saved_dish_id: string; uses: number; last: number };

export type DishFields = { name: string; slot?: MealSlot | null; components: DishComponent[]; recipeId?: string | null };

/** A stored component: only what a log entry keeps, nulls where nothing was said. */
export function component(c: Omit<MealInput, "slot"> | DishComponent): DishComponent {
  return {
    name: c.name.trim(),
    quantity: c.quantity,
    unit: c.unit,
    measure: c.measure ?? null,
    barcode: c.barcode ?? null,
    ...pick(c),
    caffeineMg: c.caffeineMg ?? null,
    alcoholG: c.alcoholG ?? null,
  };
}

function uses(): Map<string, UseRow> {
  return new Map(
    db()
      .query<UseRow, []>("SELECT saved_dish_id, count(*) AS uses, max(created_at) AS last FROM meal_dishes WHERE saved_dish_id IS NOT NULL GROUP BY saved_dish_id")
      .all()
      .map((r) => [r.saved_dish_id, r]),
  );
}

const toSaved = (r: SavedRow, used: Map<string, UseRow>): SavedDish => {
  const components = JSON.parse(r.components_json) as DishComponent[];
  return {
    id: r.id,
    name: r.name,
    slot: r.slot,
    components,
    macros: sum(components),
    recipeId: r.recipe_id,
    uses: used.get(r.id)?.uses ?? 0,
    lastUsedAt: used.get(r.id)?.last ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
};

/** Most used first, then most recently used or saved. */
export function listSavedDishes(): SavedDish[] {
  const used = uses();
  return db()
    .query<SavedRow, []>("SELECT * FROM saved_dishes")
    .all()
    .map((r) => toSaved(r, used))
    .sort((a, b) => b.uses - a.uses || (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt) || a.name.localeCompare(b.name));
}

export function findSavedDish(id: string): SavedDish | null {
  const row = db().query<SavedRow, [string]>("SELECT * FROM saved_dishes WHERE id = ?").get(id);
  return row ? toSaved(row, uses()) : null;
}

export function getSavedDish(id: string): SavedDish {
  const dish = findSavedDish(id);
  if (!dish) throw new DishError(`No saved dish ${id}: list_dishes has the ids.`);
  return dish;
}

/** A saved dish by its name: the same name, else the only one whose name holds it. */
export function savedDishNamed(name: string): SavedDish | null {
  const key = fold(name);
  const all = listSavedDishes();
  const exact = all.find((d) => fold(d.name) === key);
  if (exact) return exact;
  const partial = all.filter((d) => fold(d.name).includes(key));
  return partial.length === 1 ? partial[0]! : null;
}

export function saveDish(fields: DishFields): SavedDish {
  if (!fields.components.length) throw new DishError("A dish needs at least one component.");
  const id = randomUUID();
  const now = Date.now();
  db()
    .query("INSERT INTO saved_dishes (id, name, slot, components_json, recipe_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, fields.name.trim(), fields.slot ?? null, JSON.stringify(fields.components.map(component)), fields.recipeId ?? null, now, now);
  return getSavedDish(id);
}

export function updateSavedDish(id: string, fields: Partial<DishFields>): SavedDish {
  const dish = getSavedDish(id);
  const components = fields.components ?? dish.components;
  if (!components.length) throw new DishError("A dish needs at least one component.");
  db()
    .query("UPDATE saved_dishes SET name = ?, slot = ?, components_json = ?, updated_at = ? WHERE id = ?")
    .run((fields.name ?? dish.name).trim(), fields.slot === undefined ? dish.slot : fields.slot, JSON.stringify(components.map(component)), Date.now(), id);
  return getSavedDish(id);
}

/** Dishes already eaten from it keep their name and components. */
export function deleteSavedDish(id: string): boolean {
  return db().query("DELETE FROM saved_dishes WHERE id = ?").run(id).changes > 0;
}

/** One portion of a plan recipe as a dish: its ingredients divided by its servings. */
export function recipeDish(recipeId: string, portions = 1): DishFields {
  const recipe = findRecipe(recipeId);
  if (!recipe) throw new DishError(`No recipe ${recipeId}: list_recipes has the ids.`);
  const factor = portions / recipe.servings;
  const components = recipe.ingredients.map((i): DishComponent => {
    const household = i.unit in HOUSEHOLD_SIZES;
    const measure = household ? { amount: round2(i.quantity * factor), unit: i.unit, size: null } : null;
    const amount = measure ? toQuantity(measure) : { quantity: round2(i.quantity * factor), unit: i.unit as DishComponent["unit"] };
    return { name: i.name, ...amount, measure, barcode: null, ...scale(i, factor), caffeineMg: null, alcoholG: null };
  });
  return { name: recipe.name, components, recipeId };
}

// --- Portions and one-off changes ---

const scaled = (c: DishComponent, factor: number): DishComponent =>
  factor === 1
    ? c
    : {
        ...c,
        ...scale(c, factor),
        quantity: round2(c.quantity * factor),
        measure: c.measure && { ...c.measure, amount: round2(c.measure.amount * factor) },
        caffeineMg: c.caffeineMg === null ? null : Math.round(c.caffeineMg * factor),
        alcoholG: c.alcoholG === null ? null : Math.round(c.alcoholG * factor * 10) / 10,
      };

function componentIndex(components: DishComponent[], which: number | string): number {
  if (typeof which === "number") {
    if (!components[which]) throw new DishError(`The dish has no component ${which} (0 to ${components.length - 1}).`);
    return which;
  }
  const key = fold(which);
  const matches = components.flatMap((c, i) => (fold(c.name).includes(key) || key.includes(fold(c.name)) ? [i] : []));
  if (matches.length !== 1) {
    throw new DishError(`${matches.length ? "Several" : "No"} components match '${which}': use one of ${components.map((c, i) => `${i} ${c.name}`).join(", ")}.`);
  }
  return matches[0]!;
}

/**
 * The components to log this time: scaled by `scale` ("medio" = 0.5), then each
 * override's amount as said ("300 ml") with its macros in proportion, or the
 * component removed. A new amount must be in the component's own unit (g, ml or
 * servings once converted).
 */
export function dishPortion(components: DishComponent[], options: LogDishOptions = {}): DishComponent[] {
  const factor = options.scale ?? 1;
  if (!(factor > 0) || factor > 10) throw new DishError("scale must be above 0 and at most 10.");
  const out: (DishComponent | null)[] = components.map((c) => scaled(c, factor));
  for (const o of options.overrides ?? []) {
    const i = componentIndex(components, o.component);
    if (o.remove) {
      out[i] = null;
      continue;
    }
    if (!o.measure) continue;
    const parsed = parseMeasure(o.measure);
    const base = components[i]!;
    if (!parsed) throw new DishError(`Unreadable amount '${o.measure}': say it like '300 ml', '2 tazas' or '30 g'.`);
    if (parsed.unit !== base.unit) throw new DishError(`'${o.measure}' is ${parsed.unit} but ${base.name} is counted in ${base.unit}: give it in ${base.unit}.`);
    out[i] = { ...scaled(base, parsed.quantity / base.quantity), quantity: parsed.quantity, measure: parsed.measure };
  }
  const left = out.filter((c): c is DishComponent => c !== null);
  if (!left.length) throw new DishError("That would leave the dish with nothing in it.");
  return left;
}
