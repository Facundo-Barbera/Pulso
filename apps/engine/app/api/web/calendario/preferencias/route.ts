import { replan } from "@/src/calendar/schedule";
import { setPreferences } from "@/src/calendar/store";
import { body, respond } from "../respond";

export const dynamic = "force-dynamic";

/** Body: part of `CalendarPreferences` → `{ preferences, replan }`. */
export async function PUT(request: Request): Promise<Response> {
  const input = await body(request);
  return respond(() => ({ preferences: setPreferences(input), replan: replan() }));
}
