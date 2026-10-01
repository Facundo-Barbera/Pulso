import { listSavedDishes } from "@/src/nutrition/dishes";
import { frequentFoods } from "@/src/nutrition/store";
import { deviceOf, unpaired } from "../../auth";
import { ok } from "../http";

export const dynamic = "force-dynamic";

/** Saved dishes (most used first) and frequent foods. `?kind=snack` keeps snacks and drinks, for the "Snack o bebida" sheet. */
export function GET(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  const snacks = new URL(request.url).searchParams.get("kind") === "snack";
  return ok({ dishes: listSavedDishes(), foods: frequentFoods(12, undefined, snacks) });
}
