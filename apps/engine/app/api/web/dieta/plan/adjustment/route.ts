import { clearAdjustment } from "@/src/nutrition/store";
import { json } from "../../../http";
import { dateParam, invalid } from "../../http";

export const dynamic = "force-dynamic";

/** `?date=`: back to the plan as written for that day. */
export function DELETE(request: Request): Response {
  const date = dateParam(request);
  if (!date) return invalid("date must be YYYY-MM-DD");
  return json({ cleared: clearAdjustment(date) });
}
