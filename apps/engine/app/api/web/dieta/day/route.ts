import { localDate } from "@/src/nutrition/dates";
import { dietaDay } from "@/src/web/dieta";
import { json } from "../../http";
import { dateParam, invalid } from "../http";

export const dynamic = "force-dynamic";

/** `DietaDay` for `?date=` (default today): everything the Dieta page draws, for a client refresh. */
export function GET(request: Request): Response {
  const date = dateParam(request);
  if (date === null) return invalid("date must be YYYY-MM-DD");
  return json(dietaDay(date ?? localDate()));
}
