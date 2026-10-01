import { z } from "zod";
import { mealSchema, toMealInput } from "@/src/nutrition/inputs";
import { lookupBarcode } from "@/src/nutrition/barcode";
import { usePantryForScan } from "@/src/nutrition/pantry-use";
import { logMeal } from "@/src/nutrition/store";
import { deviceOf, unpaired } from "../../auth";
import { body, invalid, ok } from "../http";

export const dynamic = "force-dynamic";

const schema = mealSchema.extend({ source: z.enum(["manual", "barcode"]).default("manual") });

/** Logs one food or drink from the phone (quick add, snack or barcode). Macros are totals for the amount. */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const input = await body(request, schema);
  if (input instanceof Response) return input;
  const meal = toMealInput(input);
  if (typeof meal === "string") return invalid(meal);
  const logged = logMeal({ ...meal, source: input.source });
  // A scanned product in the pantry is used up; `pantry` says what is left.
  return ok({ meal: logged, pantry: await usePantryForScan(logged, (code) => lookupBarcode(code)) });
}
