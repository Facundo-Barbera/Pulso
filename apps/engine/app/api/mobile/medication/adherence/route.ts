import { adherence } from "@/src/medication/store";
import { deviceOf, unpaired } from "../../auth";
import { asOf, respond } from "../respond";

export const dynamic = "force-dynamic";

/** `?date=YYYY-MM-DD&time=HH:MM` (the phone's local clock) → `AdherenceReport`. */
export function GET(request: Request): Promise<Response> {
  if (!deviceOf(request)) return Promise.resolve(unpaired());
  const { date, time } = asOf(request);
  return respond(() => adherence(date, time));
}
