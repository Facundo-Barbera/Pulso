import { replan } from "@/src/calendar/schedule";
import { getPreferences, setPreferences } from "@/src/calendar/store";
import { deviceOf, unpaired } from "../../auth";
import { body, respond } from "../respond";

export const dynamic = "force-dynamic";

/** → `CalendarPreferences`. */
export function GET(request: Request): Promise<Response> {
  if (!deviceOf(request)) return Promise.resolve(unpaired());
  return respond(() => getPreferences());
}

/** Body: part of `CalendarPreferences`. → `{ preferences, replan }`. */
export async function PUT(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const input = await body(request);
  return respond(() => ({ preferences: setPreferences(input), replan: replan() }));
}
