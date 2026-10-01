/**
 * What the phone (`/api/mobile/nutrition/…`) and web (`/api/web/dieta/…`)
 * dish routes share: body schemas and the calls behind them. Every write
 * returns the dish's entries as `{ meals }`, or the saved dish as `{ dish }`.
 */
import type { DishComponent } from "@pulso/contract";
import { z } from "zod";
import { parseTime } from "./dates";
import { component, DishError, saveDish, updateSavedDish } from "./dishes";
import { componentSchema, dateString, slot, toMealInput } from "./inputs";
import { addToDish, logDish, logSavedDish, renameDish, saveLoggedDish, saveRecipeAsDish, type DishWhen } from "./logged-dishes";

export const componentsSchema = z.array(componentSchema).min(1).max(30);

/** Components as stored: amounts said in words read, a message (DishError) when one can't be. */
export function toComponents(items: z.infer<typeof componentSchema>[]): DishComponent[] {
  return items.map((item) => {
    const food = toMealInput(item);
    if (typeof food === "string") throw new DishError(food);
    return component(food);
  });
}

const name = z.string().trim().min(1).max(120);

/** When it was eaten: `eatenAt` (epoch ms, the phone) or `time` ("14:30" on `date`, the engine's clock — the web). */
const whenShape = {
  eatenAt: z.number().optional(),
  time: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  date: dateString.optional(),
  slot: slot.optional(),
  slotId: z.string().nullish(),
};

function when(input: { eatenAt?: number; time?: string; date?: string; slot?: DishWhen["slot"]; slotId?: string | null }): DishWhen {
  const clock = input.time ? parseTime(input.time, input.date) : null;
  if (input.time && !clock) throw new DishError(`Unreadable time '${input.time}'`);
  return { eatenAt: clock?.at ?? input.eatenAt, date: clock?.date ?? input.date, slot: input.slot, slotId: input.slotId ?? null };
}

export const saveDishSchema = z.union([
  z.object({ loggedDishId: z.string().min(1), name: name.optional(), slot: slot.nullish() }),
  z.object({ recipeId: z.string().min(1), name: name.optional(), slot: slot.nullish() }),
  z.object({ name, slot: slot.nullish(), components: componentsSchema }),
]);

/** Guardar como platillo (a logged dish), a plan recipe as a dish, or one made by hand. */
export function saveDishFrom(input: z.infer<typeof saveDishSchema>) {
  if ("loggedDishId" in input) return { dish: saveLoggedDish(input.loggedDishId, input.name, input.slot) };
  if ("recipeId" in input) return { dish: saveRecipeAsDish(input.recipeId, input.name, input.slot) };
  return { dish: saveDish({ name: input.name, slot: input.slot ?? null, components: toComponents(input.components) }) };
}

export const updateDishSchema = z.object({ name: name.optional(), slot: slot.nullish(), components: componentsSchema.optional() });

export function updateDishFrom(id: string, input: z.infer<typeof updateDishSchema>) {
  return { dish: updateSavedDish(id, { name: input.name, slot: input.slot, components: input.components && toComponents(input.components) }) };
}

export const logSavedDishSchema = z.object({
  scale: z.number().positive().max(10).optional(),
  overrides: z
    .array(z.object({ component: z.union([z.number().int().min(0), z.string().min(1)]), measure: z.string().trim().min(1).max(80).optional(), remove: z.boolean().optional() }))
    .max(30)
    .optional(),
  ...whenShape,
});

export function logSavedDishFrom(id: string, input: z.infer<typeof logSavedDishSchema>) {
  return { meals: logSavedDish(id, { scale: input.scale, overrides: input.overrides }, when(input)) };
}

export const logDishSchema = z.object({ name: name.optional(), components: componentsSchema, ...whenShape });

/** Crear platillo: a new dish eaten, from its components. */
export function logDishFrom(input: z.infer<typeof logDishSchema>) {
  return { meals: logDish(toComponents(input.components), input.name ?? null, when(input)) };
}

export const patchDishSchema = z.object({ name: name.optional(), add: componentsSchema.optional() });

/** Renames a dish eaten and/or adds foods to it. */
export function patchDishFrom(id: string, input: z.infer<typeof patchDishSchema>) {
  let meals = input.name ? renameDish(id, input.name) : null;
  if (input.add) meals = addToDish(id, toComponents(input.add));
  if (!meals) throw new DishError("Give a name or foods to add.");
  return { meals };
}
