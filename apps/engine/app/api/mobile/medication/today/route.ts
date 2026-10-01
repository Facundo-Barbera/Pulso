import { medicationDay } from "@/src/medication/store";
import { deviceOf, unpaired } from "../../auth";
import { asOf, respond } from "../respond";

export const dynamic = "force-dynamic";

/** `?date=YYYY-MM-DD&time=HH:MM` (the phone's local clock) → `MedicationDay`. */
export function GET(request: Request): Promise<Response> {
  if (!deviceOf(request)) return Promise.resolve(unpaired());
  const { date, time } = asOf(request);
  return respond(() => medicationDay(date, time));
}
