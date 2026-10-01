/**
 * Zod shapes shared by the agent tools (which take raw shapes) and the phone
 * routes (which parse untrusted bodies with `z.object(shape)`).
 */
import { MEAL_SLOTS } from "@pulso/contract";
import { z } from "zod";

export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
export const slot = z.enum(MEAL_SLOTS);
export const unit = z.enum(["g", "serving"]);

const grams = z.number().min(0).max(2000);

export const macroShape = {
  kcal: z.number().min(0).max(20000).describe("Energy in kcal"),
  protein: grams.describe("Protein in grams"),
  carbs: grams.describe("Carbohydrates in grams"),
  fat: grams.describe("Fat in grams"),
  fiber: grams.default(0).describe("Fiber in grams"),
};

export const mealShape = {
  name: z.string().trim().min(1).max(120).describe("Food name in Spanish, e.g. 'Avena con leche'"),
  slot: slot.describe("Meal slot: desayuno, media_manana, comida, merienda, cena or snack"),
  quantity: z.number().positive().max(10000).describe("Amount eaten, in `unit`"),
  unit: unit.default("g").describe("'g' for grams (use for ml too) or 'serving' for units/portions"),
  ...macroShape,
  eatenAt: z.number().int().optional().describe("When it was eaten, epoch ms. Defaults to now"),
  date: dateString.optional().describe("Local day it counts toward (YYYY-MM-DD). Defaults to the day of eatenAt"),
  barcode: z.string().max(32).nullish(),
};
export const mealSchema = z.object(mealShape);

const planItem = z.object({
  name: z.string().trim().min(1).max(120),
  quantity: z.number().positive().max(10000),
  unit,
  ...macroShape,
});

export const planShape = {
  name: z.string().trim().min(1).max(120).describe("Plan name, e.g. 'Definición 2200 kcal'"),
  notes: z.string().max(4000).nullish().describe("Free-text guidance shown with the plan: rules, swaps, hydration"),
  startsOn: dateString.optional().describe("Day the plan's first day applies (YYYY-MM-DD). Defaults to today"),
  activate: z.boolean().default(true).describe("Make this the active plan (the previous one is deactivated)"),
  days: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(60).describe("e.g. 'Lunes' or 'Día de entreno'"),
        meals: z
          .array(
            z.object({
              slot,
              name: z.string().max(120).nullish().describe("Optional dish name for the meal"),
              items: z.array(planItem).min(1).max(30).describe("Foods with quantity and the macros for that quantity"),
            }),
          )
          .min(1)
          .max(10),
      }),
    )
    .min(1)
    .max(14)
    .describe("Days in order; they repeat cyclically from startsOn. 1 day = same every day, 7 = a weekly plan"),
};
export const planSchema = z.object(planShape);

export const targetsShape = {
  kcal: z.number().min(0).max(20000).describe("Daily energy target in kcal"),
  protein: grams.describe("Daily protein in grams"),
  carbs: grams.describe("Daily carbohydrates in grams"),
  fat: grams.describe("Daily fat in grams"),
  fiber: grams.optional().describe("Daily fiber in grams. Defaults to 14 g per 1000 kcal"),
};
export const targetsSchema = z.object(targetsShape);
