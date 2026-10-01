import { z } from "zod";
import { parseTime } from "@/src/nutrition/dates";
import { mealSchema, toMealInput } from "@/src/nutrition/inputs";
import type { MealInput } from "@pulso/contract";

/** The phone's meal body, plus `time` ("14:30") on `date`, read on the engine's clock so the browser's timezone doesn't matter. */
export const webMealSchema = mealSchema.extend({
  time: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  note: z.string().trim().max(200).nullish(),
});

/** A MealInput, or a message when the amount or time can't be read. */
export function toWebMeal({ time, note, ...input }: z.infer<typeof webMealSchema>): MealInput | string {
  if (time) {
    const when = parseTime(time, input.date);
    if (!when) return `Unreadable time '${time}'`;
    input = { ...input, eatenAt: when.at, date: when.date };
  }
  const meal = toMealInput(input);
  return typeof meal === "string" || note === undefined ? meal : { ...meal, note };
}
