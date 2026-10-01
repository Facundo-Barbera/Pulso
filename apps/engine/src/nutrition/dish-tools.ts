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
  .describe("Each food in the dish with its amount (`measure` in words, as in log_meal) and TOTAL macros for that amount: kcal and grams. estimate_portion's logItem fits as is");

const dishRef = {
  id: z.string().optional().describe("The saved dish's id (list_dishes)"),
  name: z.string().trim().min(1).max(120).optional().describe("Or its name, when you don't have the id"),
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
    "The person's saved dishes (Mis platillos), most used first: id, name, usual slot, components (each with quantity in g/ml/serving, measure as said, TOTAL macros: kcal and grams), the dish's total macros and how many times it was logged. " +
      "Check it whenever the person describes something they eat often (a shake, a usual breakfast) and log a match with log_dish.",
    {},
    async () => json(listSavedDishes()),
  ),
  tool(
    "save_dish",
    "Save a dish for next time (Mis platillos), so it logs in one go: from a dish already logged (loggedDishId, the entries' dish.id: saved as eaten), from a plan recipe (recipeId: one portion), or from components. " +
      "Offer it when the person logs something they'll repeat (their shake, their usual breakfast) and save once they agree, or when they ask. Components are one default portion.",
    {
      loggedDishId: z.string().optional().describe("A logged dish to save as it was eaten"),
      recipeId: z.string().optional().describe("A plan recipe (list_recipes) to save one portion of"),
      name: z.string().trim().min(1).max(120).optional().describe("Dish name in Spanish, e.g. 'Batido de proteína'. Required with components; defaults to the logged dish's or recipe's"),
      slot: slot.nullish().describe("The meal it is usually eaten as; null when it varies (it then logs as the meal nearest the time)"),
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
    "Log a saved dish the person ate, as one meal ('me tomé mi batido de proteína'): its components at their default portion, or scaled ('medio' → scale 0.5, 'uno y medio' → 1.5), " +
      "with one-off changes just this time ('con 300 ml de leche hoy' → overrides [{ component: 'leche', measure: '300 ml' }]; macros follow the amount; 'sin fresas' → remove) and foods added just this time (add). The saved dish itself does not change: use update_dish for that. " +
      "Tie it to the plan like log_meal (at, slotId). Tell the person you used their saved dish.",
    {
      ...dishRef,
      scale: z.number().positive().max(10).optional().describe("Portion factor, 1 by default"),
      overrides: z
        .array(
          z.object({
            component: z.union([z.number().int().min(0), z.string().trim().min(1)]).describe("Component index (0-based, as list_dishes orders them) or part of its name"),
            measure: z.string().trim().min(1).max(80).optional().describe("New amount in words, in the component's own kind of unit: '300 ml', '2 tazas', '40 g'"),
            remove: z.boolean().optional().describe("Leave it out this time"),
          }),
        )
        .max(30)
        .optional(),
      add: components.optional().describe("Foods added just this time"),
      slot: slot.optional().describe("Defaults to the dish's usual meal, else the meal nearest the time"),
      at: z.string().max(40).optional().describe("Local time it happened, 'HH:MM' 24 h, or an ISO 8601 date-time. Defaults to now"),
      date: dateString.optional().describe("Local day (YYYY-MM-DD) it counts toward. Defaults to the day of `at`, i.e. today"),
      slotId: z.string().optional().describe("The plan slot (get_diet_horizon) it is, when the time alone would put it in the wrong meal"),
      description: z.string().trim().max(300).optional().describe("The person's own words, in Spanish"),
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
    "Change a saved dish for good: rename it, set its usual slot, or replace its components (send the whole list as it should be from now on). Dishes already logged keep what they were.",
    {
      ...dishRef,
      newName: z.string().trim().min(1).max(120).optional(),
      slot: slot.nullish().describe("Its usual meal; null when it varies"),
      components: components.optional(),
    },
    async ({ id, name, newName, slot: usual, components: items }) =>
      safely(() => updateSavedDish(findDish(id, name).id, { name: newName, slot: usual, components: items && toComponents(items) })),
  ),
  tool(
    "delete_dish",
    "Delete a saved dish the person no longer wants in Mis platillos. Dishes already logged keep their entries.",
    dishRef,
    async ({ id, name }) => safely(() => ({ deleted: deleteSavedDish(findDish(id, name).id) })),
  ),
];
