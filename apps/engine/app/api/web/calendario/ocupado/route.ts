import { replan } from "@/src/calendar/schedule";
import { addBusyBlock } from "@/src/calendar/store";
import { body, respond } from "../respond";

export const dynamic = "force-dynamic";

/** Body: `BusyBlockInput` → `{ block, replan }`: what the new block moved in the training plan. */
export async function POST(request: Request): Promise<Response> {
  const input = await body(request);
  return respond(() => ({ block: addBusyBlock(input), replan: replan() }));
}
