import { plannedView, planTrainingWeek } from "@/src/calendar/schedule";
import { validRange } from "@/src/calendar/timeline";
import { deviceOf, unpaired } from "../../auth";
import { body, params, respond } from "../respond";

export const dynamic = "force-dynamic";

/** `?from&to` → `{ sessions: PlannedSession[] }`. */
export function GET(request: Request): Promise<Response> {
  if (!deviceOf(request)) return Promise.resolve(unpaired());
  const query = params(request);
  return respond(() => {
    const { from, to } = validRange(query.get("from"), query.get("to"));
    return { sessions: plannedView(from, to) };
  });
}

/** Body: `{ from?: string }`. Plans the active program over 7 days → `PlanWeekResult`. */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const input = ((await body(request)) ?? {}) as { from?: string };
  return respond(() => planTrainingWeek({ from: input.from }));
}
