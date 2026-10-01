/**
 * Zod shapes shared by the agent tools (which take raw shapes) and the phone
 * routes (which parse untrusted bodies with `z.object(shape)`).
 */
import { HOUSEHOLD_UNITS, MEAL_SLOTS, MEASURE_UNITS, QUANTITY_UNITS, WATER_UNITS, type MealInput } from "@pulso/contract";
import { z } from "zod";
import { parseMeasure, toQuantity } from "./measure";

export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
export const slot = z.enum(MEAL_SLOTS);
export const unit = z.enum(QUANTITY_UNITS);

const grams = z.number().min(0).max(2000);

export const macroShape = {
  kcal: z.number().min(0).max(20000).describe("Energy in kcal"),
  protein: grams.describe("Protein in grams"),
  carbs: grams.describe("Carbohydrates in grams"),
  fat: grams.describe("Fat in grams"),
  fiber: grams.default(0).describe("Fiber in grams"),
};

export const measureSchema = z.object({
  amount: z.number().positive().max(10000),
  unit: z.enum(MEASURE_UNITS),
  size: z.number().positive().max(5000).nullish().describe("g or ml in one household unit, when not its default"),
});

export const mealShape = {
  name: z.string().trim().min(1).max(120).describe("Food or drink name in Spanish, e.g. 'Avena con leche', 'Coca-Cola'"),
  slot: slot.describe(
    "Meal slot: desayuno, media_manana, comida, merienda, cena or snack. Use snack for anything eaten or drunk between meals, at any hour; a day can have several",
  ),
  measure: z
    .union([z.string().trim().min(1).max(80), measureSchema])
    .optional()
    .describe(
      `How much, in the person's words: '2 latas', '1 taza', 'media taza', '250 ml', '33 cl', '30 g', 'un puño', '2 galletas', 'una lata de 330 ml', '2 unidades de 11 g'. Household units and their default sizes: taza 240 ml, vaso 250 ml, lata 355 ml, botella 500 ml, cucharada 15 ml, cucharadita 5 ml, puño 30 g; add the size when it differs ('una botella de 330 ml'). A count of things without a weight ('2 galletas') is stored as servings. Prefer this over quantity + unit`,
    ),
  quantity: z.number().positive().max(10000).optional().describe("Amount in `unit`, only when not using `measure`"),
  unit: unit.optional().describe("'g' for grams, 'ml' for drinks and other liquids, 'serving' for portions. Defaults to 'g'; ignored with `measure`"),
  ...macroShape,
  caffeineMg: z.number().min(0).max(2000).nullish().describe("Caffeine in mg, for coffee, tea, mate, cola or energy drinks (an espresso ≈ 63 mg, a 355 ml cola ≈ 34 mg)"),
  alcoholG: z.number().min(0).max(500).nullish().describe("Grams of pure alcohol, for alcoholic drinks: ml × ABV × 0.789 (a 330 ml beer at 5 % ≈ 13 g)"),
  eatenAt: z.number().optional().describe("When it was eaten, epoch ms. Defaults to now"),
  date: dateString.optional().describe("Local day it counts toward (YYYY-MM-DD). Defaults to the day of eatenAt"),
  barcode: z.string().max(32).nullish(),
};
export const mealSchema = z.object(mealShape);

/**
 * A parsed meal ready to store: the normalized quantity comes from `measure`
 * when there is one, else from quantity + unit (grams by default). A message
 * instead when the amount is missing or unreadable.
 */
export function toMealInput({ measure, quantity, unit: quantityUnit, ...rest }: z.infer<typeof mealSchema>): MealInput | string {
  if (typeof measure === "string") {
    const parsed = parseMeasure(measure);
    return parsed ? { ...rest, ...parsed } : `Unreadable measure '${measure}': say it like '2 latas', '250 ml' or '30 g'`;
  }
  if (measure) {
    const household = (HOUSEHOLD_UNITS as readonly string[]).includes(measure.unit);
    const said = { amount: measure.amount, unit: measure.unit, size: household ? (measure.size ?? null) : null };
    return { ...rest, measure: said, ...toQuantity(said) };
  }
  if (quantity === undefined) return `'${rest.name}' needs a measure or a quantity`;
  return { ...rest, quantity, unit: quantityUnit ?? "g" };
}

export const planItem = z.object({
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
  horizonDays: z.number().int().min(3).max(28).optional().describe("Days the plan is laid out ahead as dated meals (and the shopping list's default), usually 7 or 14. Default 14"),
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

export const waterSettingsSchema = z.object({
  goalMl: z.number().min(250).max(10000).nullable().optional(),
  unit: z.enum(WATER_UNITS).optional(),
  glassMl: z.number().min(50).max(1000).optional(),
  bottleMl: z.number().min(100).max(3000).optional(),
});
