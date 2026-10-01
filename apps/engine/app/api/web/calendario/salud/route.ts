import { replan } from "@/src/calendar/schedule";
import { addHealthEvent } from "@/src/calendar/store";
import { local } from "@/src/calendar/time";
import { body, respond } from "../respond";

export const dynamic = "force-dynamic";

/** Body: `HealthEventInput` → `{ event, replan }`. */
export async function POST(request: Request): Promise<Response> {
  const input = await body(request);
  return respond(() => ({ event: addHealthEvent(input, local().date), replan: replan() }));
}
