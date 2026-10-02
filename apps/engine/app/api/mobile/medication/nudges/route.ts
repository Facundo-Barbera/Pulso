import { nudges } from "@/src/medication/store";
import { deviceOf, unpaired } from "../../auth";
import { asOf, respond } from "../respond";

export const dynamic = "force-dynamic";

/** `?date=YYYY-MM-DD` (the phone's local date) → `ScheduleNudge[]`: as-needed meds that look scheduled. */
export function GET(request: Request): Promise<Response> {
  if (!deviceOf(request)) return Promise.resolve(unpaired());
  const { date } = asOf(request);
  return respond(() => ({ nudges: nudges(date) }));
}
