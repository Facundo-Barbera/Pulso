import { upcomingSlots } from "@/src/medication/store";
import { deviceOf, unpaired } from "../../auth";
import { asOf, respond } from "../respond";

export const dynamic = "force-dynamic";

/**
 * `?date=YYYY-MM-DD&time=HH:MM` (the phone's local clock) → `MedicationUpcoming`:
 * the next 7 days of slots, resolved, for the phone to plan its reminders.
 */
export function GET(request: Request): Promise<Response> {
  if (!deviceOf(request)) return Promise.resolve(unpaired());
  const { date, time } = asOf(request);
  return respond(() => upcomingSlots(date, time));
}
