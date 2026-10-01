import { timeline, validRange } from "@/src/calendar/timeline";
import { respond } from "./respond";

export const dynamic = "force-dynamic";

/** `?from=YYYY-MM-DD&to=YYYY-MM-DD` (at most 125 days) → `CalendarRange`: every feature's items on one timeline. */
export function GET(request: Request): Response {
  const query = new URL(request.url).searchParams;
  return respond(() => {
    const { from, to } = validRange(query.get("from"), query.get("to"));
    return timeline(from, to);
  });
}
