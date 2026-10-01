import { localDate, planForDay } from "@/src/nutrition/store";
import { deviceOf, unpaired } from "../../auth";
import { dateParam, invalid, ok } from "../http";

export const dynamic = "force-dynamic";

/** The active plan and the day of it that applies on `?date=` (default today). `{ plan: null }` without one. */
export function GET(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  const date = dateParam(request);
  if (date === null) return invalid("date must be YYYY-MM-DD");
  return ok({ plan: planForDay(date ?? localDate()) });
}
