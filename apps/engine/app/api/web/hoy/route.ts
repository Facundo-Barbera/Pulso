import { todayOverview } from "@/src/web/today";
import { json } from "../http";

export const dynamic = "force-dynamic";

/** `TodayOverview`: everything the Hoy page draws, for a client refresh. */
export function GET(): Response {
  return json(todayOverview());
}
