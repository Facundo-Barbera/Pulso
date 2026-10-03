/** Recipes (ingredients for the whole pot, prep time, servings) and the prep batches cooked from them. */
import { randomUUID } from "node:crypto";
import { MEASURE_UNITS, type PlanItem, type PrepStatus, type Recipe, type RecipeIngredient } from "@pulso/contract";
import { z } from "zod";
import { db } from "../db";
import type { Line } from "../shopping/aggregate";
import { macroShape } from "./inputs";
import { pick, scale, sum } from "./macros";

export const ingredientSchema = z.object({
  name: z.string().trim().min(1).max(120).describe("In Spanish, as bought: 'Tomate triturado'"),
  quantity: z.number().positive().max(10000).describe("For the WHOLE recipe"),
  unit: z.enum(MEASURE_UNITS),
  ...macroShape,
});

export const recipeShape = {
  name: z.string().trim().min(1).max(120).describe("In Spanish, e.g. 'Pasta boloñesa'"),
  servings: z.number().positive().max(30).describe("Portions it makes"),
  prepMinutes: z.number().int().min(0).max(600).describe("Active cooking minutes"),
  batch: z.boolean().default(false).describe("Keeps well for days (stews, lentils): good for meal prep"),
  ingredients: z.array(ingredientSchema).min(1).max(40).describe("TOTAL macros for each amount"),
  steps: z.string().trim().max(4000).nullish().describe("Short method, in Spanish"),
};
export const recipeSchema = z.object(recipeShape);

export class RecipeError extends Error {}

type RecipeRow = {
  id: string;
  name: string;
  servings: number;
  prep_minutes: number;
  batch: number;
  ingredients_json: string;
  steps: string | null;
  variant_of: string | null;
  created_at: number;
};

const toRecipe = (r: RecipeRow): Recipe => {
  const ingredients = JSON.parse(r.ingredients_json) as RecipeIngredient[];
  return {
    id: r.id,
    name: r.name,
    servings: r.servings,
    prepMinutes: r.prep_minutes,
    batch: r.batch === 1,
    ingredients,
    perServing: scale(sum(ingredients), 1 / r.servings),
    steps: r.steps,
    variantOf: r.variant_of,
    createdAt: r.created_at,
  };
};

export function createRecipe(input: z.input<typeof recipeSchema>, variantOf: string | null = null): Recipe {
  const r = recipeSchema.parse(input);
  const id = randomUUID();
  db()
    .query(
      "INSERT INTO recipes (id, name, servings, prep_minutes, batch, ingredients_json, steps, variant_of, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(id, r.name, r.servings, r.prepMinutes, r.batch ? 1 : 0, JSON.stringify(r.ingredients.map((i) => ({ ...pick(i), name: i.name, quantity: i.quantity, unit: i.unit }))), r.steps ?? null, variantOf, Date.now());
  return getRecipe(id);
}

export function findRecipe(id: string): Recipe | null {
  const row = db().query<RecipeRow, [string]>("SELECT * FROM recipes WHERE id = ?").get(id);
  return row ? toRecipe(row) : null;
}

export function getRecipe(id: string): Recipe {
  const recipe = findRecipe(id);
  if (!recipe) throw new RecipeError(`No recipe ${id}: list_recipes has the ids.`);
  return recipe;
}

/** Newest first; variants included. */
export function listRecipes(): Recipe[] {
  return db().query<RecipeRow, []>("SELECT * FROM recipes ORDER BY created_at DESC").all().map(toRecipe);
}

/** The plan item a slot shows for `portions` of a recipe: the dish, in servings. */
export function dishItem(recipe: Recipe, portions: number): PlanItem {
  return { id: randomUUID(), name: recipe.name, quantity: portions, unit: "serving", ...scale(recipe.perServing, portions) };
}

/** What `portions` of a recipe take, as shopping lines. */
export function ingredientLines(recipe: Recipe, portions: number): Line[] {
  const factor = portions / recipe.servings;
  return recipe.ingredients.map((i) => ({ name: i.name, quantity: i.quantity * factor, unit: i.unit }));
}

// --- Prep batches ---

export type PrepRow = {
  id: string;
  plan_id: string;
  recipe_id: string;
  cook_date: string;
  portions: number;
  status: PrepStatus;
  cooked_at: number | null;
  created_at: number;
};

export function insertPrep(planId: string, recipeId: string, cookDate: string, portions: number, id: string = randomUUID()): PrepRow {
  const row: PrepRow = { id, plan_id: planId, recipe_id: recipeId, cook_date: cookDate, portions, status: "planned", cooked_at: null, created_at: Date.now() };
  db()
    .query("INSERT INTO prep_batches (id, plan_id, recipe_id, cook_date, portions, status, cooked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(row.id, row.plan_id, row.recipe_id, row.cook_date, row.portions, row.status, row.cooked_at, row.created_at);
  return row;
}

export function getPrepRow(id: string): PrepRow {
  const row = db().query<PrepRow, [string]>("SELECT * FROM prep_batches WHERE id = ?").get(id);
  if (!row) throw new RecipeError(`No prep batch ${id}: get_diet_horizon lists them.`);
  return row;
}

export function prepRows(planId: string): PrepRow[] {
  return db().query<PrepRow, [string]>("SELECT * FROM prep_batches WHERE plan_id = ? ORDER BY cook_date, created_at").all(planId);
}

export function updatePrep(id: string, fields: Partial<Pick<PrepRow, "status" | "cooked_at" | "portions" | "recipe_id" | "cook_date">>): void {
  const row = { ...getPrepRow(id), ...fields };
  db()
    .query("UPDATE prep_batches SET status = ?, cooked_at = ?, portions = ?, recipe_id = ?, cook_date = ? WHERE id = ?")
    .run(row.status, row.cooked_at, row.portions, row.recipe_id, row.cook_date, id);
}
