import { localDate, nutritionDay } from "@/src/nutrition/store";
import { deviceOf, unpaired } from "../../auth";
import { dateParam, invalid, ok } from "../http";

export const dynamic = "force-dynamic";

/** Everything the Dieta tab draws for `?date=` (default today): summary, meals and the plan day. */
export function GET(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  const date = dateParam(request);
  if (date === null) return invalid("date must be YYYY-MM-DD");
  return ok(nutritionDay(date ?? localDate()));
}
