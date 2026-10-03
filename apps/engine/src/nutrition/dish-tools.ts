/** The Coach's tools for saved dishes (Mis platillos): save, list, log (scaled or tweaked), update and delete. */
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { parseTime } from "./dates";
import { toComponents } from "./dish-api";
import { deleteSavedDish, DishError, getSavedDish, listSavedDishes, savedDishNamed, saveDish, updateSavedDish } from "./dishes";
import { componentSchema, dateString, slot } from "./inputs";
import { logSavedDish, saveLoggedDish, saveRecipeAsDish } from "./logged-dishes";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

/** Runs a call whose known errors (DishError) are messages for the Coach. */
export async function safely(run: () => unknown) {
  try {
    return json(await run());
  } catch (error) {
    if (error instanceof DishError) return fail(`Error: ${error.message}`);
    throw error;
  }
}

const components = z
  .array(componentSchema)
  .min(1)
  .max(30)
  .describe("One per food, with TOTAL macros for its amount (estimate_portion's logItem fits as is)");

const dishRef = {
  id: z.string().optional().describe("Saved dish id (list_dishes)"),
  name: z.string().trim().min(1).max(120).optional().describe("Or its name"),
};

function findDish(id?: string, name?: string) {
  if (id) return getSavedDish(id);
  const dish = name ? savedDishNamed(name) : null;
  if (!dish) throw new DishError(name ? `No saved dish named '${name}': list_dishes has them.` : "Give the dish's id or name.");
  return dish;
}

export const dishTools = [
  tool(
    "list_dishes",
    "Saved dishes (Mis platillos), most used first: id, name, usual slot, components (quantity g/ml/serving, measure as said, TOTAL macros), the dish's macros and times logged. Log a match with log_dish.",
    {},
    async () => json(listSavedDishes()),
  ),
  tool(
    "save_dish",
    "Save a dish (Mis platillos) to log in one go, once the person agrees or asks: from a logged dish (loggedDishId = the entries' dish.id, as eaten), a plan recipe (recipeId, one portion) or components (one default portion).",
    {
      loggedDishId: z.string().optional(),
      recipeId: z.string().optional().describe("From list_recipes"),
      name: z.string().trim().min(1).max(120).optional().describe("In Spanish. Required with components; else the source's"),
      slot: slot.nullish().describe("Usual meal; null when it varies (then the meal nearest the time)"),
      components: components.optional(),
    },
    async ({ loggedDishId, recipeId, name, slot: usual, components: items }) =>
      safely(() => {
        if (loggedDishId) return saveLoggedDish(loggedDishId, name, usual);
        if (recipeId) return saveRecipeAsDish(recipeId, name, usual);
        if (!items || !name) throw new DishError("Give loggedDishId, recipeId, or a name with components.");
        return saveDish({ name, slot: usual ?? null, components: toComponents(items) });
      }),
  ),
  tool(
    "log_dish",
    "Log a saved dish as one meal: default portion or scaled ('medio' → 0.5), with one-off changes ('con 300 ml de leche hoy' → overrides [{ component: 'leche', measure: '300 ml' }]; 'sin fresas' → remove) and one-off foods (add). The saved dish stays as is (update_dish changes it). Tied to the plan like log_meal.",
    {
      ...dishRef,
      scale: z.number().positive().max(10).optional().describe("Default 1"),
      overrides: z
        .array(
          z.object({
            component: z.union([z.number().int().min(0), z.string().trim().min(1)]).describe("0-based index (list_dishes order) or part of its name"),
            measure: z.string().trim().min(1).max(80).optional().describe("New amount in words, same kind of unit"),
            remove: z.boolean().optional(),
          }),
        )
        .max(30)
        .optional(),
      add: components.optional().describe("Foods added this time"),
      slot: slot.optional().describe("Default the dish's usual, else nearest the time"),
      at: z.string().max(40).optional().describe("Local 'HH:MM' (24 h) or ISO 8601 date-time; default now"),
      date: dateString.optional().describe("Local day it counts toward; default `at`'s"),
      slotId: z.string().optional().describe("Plan slot (get_diet_horizon), only when the time would pick the wrong meal"),
      description: z.string().trim().max(300).optional().describe("Their words, in Spanish"),
    },
    async ({ id, name, scale, overrides, add, slot: as, at, date, slotId, description }) =>
      safely(() => {
        const when = at ? parseTime(at, date) : null;
        if (at && !when) throw new DishError(`Unreadable time '${at}': use 'HH:MM' or ISO 8601`);
        const dish = findDish(id, name);
        return logSavedDish(
          dish.id,
          { scale, overrides, add: add && toComponents(add) },
          { eatenAt: when?.at, date: when?.date ?? date, slot: as, slotId: slotId ?? null, note: description ?? null },
          "agent",
        );
      }),
  ),
  tool(
    "update_dish",
    "Change a saved dish for good: rename, usual slot, or components (the whole new list). Logged dishes keep what they were.",
    {
      ...dishRef,
      newName: z.string().trim().min(1).max(120).optional(),
      slot: slot.nullish().describe("null when it varies"),
      components: components.optional(),
    },
    async ({ id, name, newName, slot: usual, components: items }) =>
      safely(() => updateSavedDish(findDish(id, name).id, { name: newName, slot: usual, components: items && toComponents(items) })),
  ),
  tool(
    "delete_dish",
    "Delete a saved dish (Mis platillos). Logged dishes keep their entries.",
    dishRef,
    async ({ id, name }) => safely(() => ({ deleted: deleteSavedDish(findDish(id, name).id) })),
  ),
];
