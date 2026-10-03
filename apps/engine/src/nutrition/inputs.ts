/**
 * Zod shapes shared by the agent tools (which take raw shapes) and the phone
 * routes (which parse untrusted bodies with `z.object(shape)`).
 */
import { HOUSEHOLD_UNITS, MEAL_SLOTS, MEASURE_UNITS, QUANTITY_UNITS, WATER_UNITS, type MealInput, type QuantityUnit } from "@pulso/contract";
import { z } from "zod";
import { parseMeasure, toQuantity } from "./measure";

export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
export const slot = z.enum(MEAL_SLOTS);
export const unit = z.enum(QUANTITY_UNITS);

const grams = z.number().min(0).max(2000);

export const macroShape = {
  kcal: z.number().min(0).max(20000),
  protein: grams.describe("g"),
  carbs: grams.describe("g"),
  fat: grams.describe("g"),
  fiber: grams.default(0).describe("g"),
};

export const measureSchema = z.object({
  amount: z.number().positive().max(10000),
  unit: z.enum(MEASURE_UNITS),
  size: z.number().positive().max(5000).nullish().describe("g or ml in one household unit, when not its default"),
  base: z.enum(["g", "ml"]).optional().describe("Whether `size` is g or ml; default the unit's own. estimate_portion sets it"),
});

export const mealShape = {
  name: z.string().trim().min(1).max(120).describe("In Spanish, e.g. 'Avena con leche'"),
  slot: slot.describe("snack = anything between meals, at any hour"),
  measure: z
    .union([z.string().trim().min(1).max(80), measureSchema])
    .optional()
    .describe(
      "How much, in the person's words; preferred over quantity + unit: '2 latas', '250 ml', '30 g', 'un puño', '2 galletas' (a count without weight = servings). Defaults: taza 240 ml, vaso 250, lata 355, botella 500, cucharada 15, cucharadita 5, puño 30 g; say the size when it differs ('una botella de 330 ml')",
    ),
  quantity: z.number().positive().max(10000).optional().describe("In `unit`, only without `measure`"),
  unit: unit.optional().describe("Default 'g'; ignored with `measure`"),
  ...macroShape,
  caffeineMg: z.number().min(0).max(2000).nullish().describe("For coffee, tea, mate, cola, energy drinks (espresso ≈ 63 mg)"),
  alcoholG: z.number().min(0).max(500).nullish().describe("Pure alcohol: ml × ABV × 0.789"),
  eatenAt: z.number().optional().describe("Epoch ms; default now"),
  date: dateString.optional().describe("Local day it counts toward; default eatenAt's"),
  barcode: z.string().max(32).nullish(),
};
export const mealSchema = z.object(mealShape);

/** One food of a dish: a meal item without its own slot or time (the dish has them). */
export const componentSchema = mealSchema.omit({ slot: true, eatenAt: true, date: true });

type Amount = { name: string; measure?: z.infer<typeof mealSchema>["measure"]; quantity?: number; unit?: QuantityUnit };
type Parsed<T> = Omit<T, "measure" | "quantity" | "unit"> & Pick<MealInput, "quantity" | "unit" | "measure">;

/**
 * A parsed meal (or dish component) ready to store: the normalized quantity
 * comes from `measure` when there is one, else from quantity + unit (grams by
 * default). A message instead when the amount is missing or unreadable.
 */
export function toMealInput<T extends Amount>({ measure, quantity, unit: quantityUnit, ...rest }: T): Parsed<T> | string {
  if (typeof measure === "string") {
    const parsed = parseMeasure(measure);
    return parsed ? { ...rest, ...parsed } : `Unreadable measure '${measure}': say it like '2 latas', '250 ml' or '30 g'`;
  }
  if (measure) {
    const household = (HOUSEHOLD_UNITS as readonly string[]).includes(measure.unit);
    const said = { amount: measure.amount, unit: measure.unit, size: household ? (measure.size ?? null) : null };
    return { ...rest, measure: said, ...toQuantity(said, measure.base) };
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
  name: z.string().trim().min(1).max(120).describe("e.g. 'Definición 2200 kcal'"),
  notes: z.string().max(4000).nullish().describe("Guidance shown with the plan"),
  startsOn: dateString.optional().describe("Day the first day applies; default today"),
  activate: z.boolean().default(true).describe("Make it active, deactivating the previous"),
  horizonDays: z.number().int().min(3).max(28).optional().describe("Days laid out ahead as dated meals (and the shopping list's default). Default 14"),
  days: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(60).describe("e.g. 'Lunes'"),
        meals: z
          .array(
            z.object({
              slot,
              name: z.string().max(120).nullish().describe("Dish name"),
              items: z.array(planItem).min(1).max(30).describe("TOTAL macros for each quantity"),
            }),
          )
          .min(1)
          .max(10),
      }),
    )
    .min(1)
    .max(14)
    .describe("Repeat cyclically from startsOn: 1 = same every day, 7 = weekly"),
};
export const planSchema = z.object(planShape);

export const targetsShape = {
  kcal: z.number().min(0).max(20000),
  protein: grams.describe("g"),
  carbs: grams.describe("g"),
  fat: grams.describe("g"),
  fiber: grams.optional().describe("g; default 14 per 1000 kcal"),
  zones: z
    .partialRecord(
      z.enum(["kcal", "protein", "carbs", "fat", "fiber"]),
      z
        .object({
          min: z.number().min(0).max(20000).nullish().describe("kcal or g; less is 'below'"),
          max: z.number().min(0).max(20000).nullish().describe("More is 'above'; with kind 'min' it only ends the drawn band"),
          kind: z.enum(["min", "range", "max"]).optional().describe("min = at least; range = between; max = under. Default from the bounds"),
        })
        .refine((zone) => zone.min == null || zone.max == null || zone.min <= zone.max, "min must not exceed max"),
    )
    .optional()
    .describe(
      "Custom 'estás bien aquí' bands, only where the derived ones don't fit. Derived: kcal −10/+5 % losing fat (±5 % maintaining, −5/+10 % gaining), protein and fiber ≥ target, carbs and fat −20/+10 %. Each call replaces all custom zones.",
    ),
};
export const targetsSchema = z.object(targetsShape);

export const waterSettingsSchema = z.object({
  goalMl: z.number().min(250).max(10000).nullable().optional(),
  unit: z.enum(WATER_UNITS).optional(),
  glassMl: z.number().min(50).max(1000).optional(),
  bottleMl: z.number().min(100).max(3000).optional(),
});
