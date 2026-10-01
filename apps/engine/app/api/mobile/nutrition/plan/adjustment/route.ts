import { clearAdjustment, localDate } from "@/src/nutrition/store";
import { deviceOf, unpaired } from "../../../auth";
import { dateParam, invalid, ok } from "../../http";

export const dynamic = "force-dynamic";

/** "Volver al plan": drops the Coach's adjustment for `?date=` (default today). */
export function DELETE(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  const date = dateParam(request);
  if (date === null) return invalid("date must be YYYY-MM-DD");
  return ok({ cleared: clearAdjustment(date ?? localDate()) });
}
