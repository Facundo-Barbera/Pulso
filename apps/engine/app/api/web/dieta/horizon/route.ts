import { dietHorizon } from "@/src/nutrition/horizon";
import { dateParam, diet, intParam, invalid } from "../http";

export const dynamic = "force-dynamic";

/** `?from=YYYY-MM-DD&days=N` (default today and the plan's horizon): the dated plan, `{ horizon: DietHorizon | null }`. */
export function GET(request: Request): Promise<Response> | Response {
  const from = dateParam(request, "from");
  const days = intParam(request, "days", 1, 31);
  if (from === null || days === null) return invalid("from must be YYYY-MM-DD and days 1–31");
  return diet(() => ({ horizon: dietHorizon(from, days) }));
}
