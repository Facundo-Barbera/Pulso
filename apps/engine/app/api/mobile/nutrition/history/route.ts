import { addDays, localDate, summaries } from "@/src/nutrition/store";
import { waterTotals } from "@/src/nutrition/water";
import { deviceOf, unpaired } from "../../auth";
import { dateParam, invalid, ok } from "../http";

export const dynamic = "force-dynamic";

/** Daily summaries and water ml per day (absent days drank nothing) for the `?days=` (default 7, max 90) days ending `?to=` (default today). */
export function GET(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  const to = dateParam(request, "to");
  const days = Number(new URL(request.url).searchParams.get("days") ?? 7);
  if (to === null || !Number.isInteger(days) || days < 1 || days > 90) return invalid("expected ?days=1..90&to=YYYY-MM-DD");
  const end = to ?? localDate();
  const start = addDays(end, 1 - days);
  return ok({ days: summaries(start, end), water: waterTotals(start, end) });
}
