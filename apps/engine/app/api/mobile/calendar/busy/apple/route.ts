import { replan } from "@/src/calendar/schedule";
import { syncAppleCalendar } from "@/src/calendar/store";
import { deviceOf, unpaired } from "../../../auth";
import { body, respond } from "../../respond";

export const dynamic = "force-dynamic";

/** Body: `AppleCalendarSync` (busy times read on the phone, read-only). → `{ written, replan }`. */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const input = await body(request);
  return respond(() => ({ written: syncAppleCalendar(input), replan: replan() }));
}
