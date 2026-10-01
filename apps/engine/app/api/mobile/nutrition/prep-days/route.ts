import { localDate } from "@/src/nutrition/dates";
import { suggestPrepDays } from "@/src/nutrition/prepdays";
import { deviceOf, unpaired } from "../../auth";
import { dateParam, diet, intParam, invalid } from "../http";

export const dynamic = "force-dynamic";

/** `?from=&days=` (default today, 7): days ranked by room to cook a batch, from the calendar. */
export function GET(request: Request): Promise<Response> | Response {
  if (!deviceOf(request)) return unpaired();
  const from = dateParam(request, "from");
  const days = intParam(request, "days", 3, 14);
  if (from === null || days === null) return invalid("from must be YYYY-MM-DD and days 3–14");
  return diet(() => suggestPrepDays(from ?? localDate(), days ?? 7));
}
