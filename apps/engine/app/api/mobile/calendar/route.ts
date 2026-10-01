import { timeline, validRange } from "@/src/calendar/timeline";
import { deviceOf, unpaired } from "../auth";
import { params, respond } from "./respond";

export const dynamic = "force-dynamic";

/** `?from=YYYY-MM-DD&to=YYYY-MM-DD` (at most 125 days) → `CalendarRange`: every feature's items on one timeline. */
export function GET(request: Request): Promise<Response> {
  if (!deviceOf(request)) return Promise.resolve(unpaired());
  const query = params(request);
  return respond(() => {
    const { from, to } = validRange(query.get("from"), query.get("to"));
    return timeline(from, to);
  });
}
