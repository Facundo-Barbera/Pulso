import { addDays, localDate, summaries } from "@/src/nutrition/store";
import { deviceOf, unpaired } from "../../auth";
import { dateParam, invalid, ok } from "../http";

export const dynamic = "force-dynamic";

/** Daily summaries for the `?days=` (default 7, max 90) days ending `?to=` (default today). */
export function GET(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  const to = dateParam(request, "to");
  const days = Number(new URL(request.url).searchParams.get("days") ?? 7);
  if (to === null || !Number.isInteger(days) || days < 1 || days > 90) return invalid("expected ?days=1..90&to=YYYY-MM-DD");
  const end = to ?? localDate();
  return ok({ days: summaries(addDays(end, 1 - days), end) });
}
