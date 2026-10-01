import { z } from "zod";
import { mealSchema } from "@/src/nutrition/inputs";
import { logMeal } from "@/src/nutrition/store";
import { deviceOf, unpaired } from "../../auth";
import { body, ok } from "../http";

export const dynamic = "force-dynamic";

const schema = mealSchema.extend({ source: z.enum(["manual", "barcode"]).default("manual") });

/** Logs one food from the phone (quick add or barcode). Macros are totals for the quantity. */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const input = await body(request, schema);
  if (input instanceof Response) return input;
  return ok({ meal: logMeal(input) });
}
