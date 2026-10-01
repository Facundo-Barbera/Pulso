import { z } from "zod";
import { lookupBarcode } from "@/src/nutrition/barcode";
import { usePantryForScan } from "@/src/nutrition/pantry-use";
import { logMeal } from "@/src/nutrition/store";
import { json } from "../../http";
import { body, invalid } from "../http";
import { toWebMeal, webMealSchema } from "./schema";

export const dynamic = "force-dynamic";

const schema = webMealSchema.extend({ source: z.enum(["manual", "barcode"]).default("manual"), offPlan: z.boolean().optional() });

/** Logs one food or drink. Macros are totals for the amount. */
export async function POST(request: Request): Promise<Response> {
  const input = await body(request, schema);
  if (input instanceof Response) return input;
  const { source, offPlan, ...rest } = input;
  const meal = toWebMeal(rest);
  if (typeof meal === "string") return invalid(meal);
  const logged = logMeal({ ...meal, offPlan, source });
  // A scanned product in the pantry is used up; `pantry` says what is left.
  return json({ meal: logged, pantry: await usePantryForScan(logged, (code) => lookupBarcode(code)) });
}
