import { replan } from "@/src/calendar/schedule";
import { addHealthEvent, listHealthEvents } from "@/src/calendar/store";
import { local } from "@/src/calendar/time";
import { deviceOf, unpaired } from "../../auth";
import { body, respond } from "../respond";

export const dynamic = "force-dynamic";

/** → `{ events: HealthEvent[] }`, active first, then history. */
export function GET(request: Request): Promise<Response> {
  if (!deviceOf(request)) return Promise.resolve(unpaired());
  return respond(() => ({ events: listHealthEvents() }));
}

/** Body: `HealthEventInput`. → `{ event, replan }`. */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const input = await body(request);
  return respond(() => ({ event: addHealthEvent(input, local().date), replan: replan() }));
}
