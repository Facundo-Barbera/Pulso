import { frequentFoods } from "@/src/nutrition/store";
import { deviceOf, unpaired } from "../../auth";
import { ok } from "../http";

export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  return ok({ foods: frequentFoods() });
}
