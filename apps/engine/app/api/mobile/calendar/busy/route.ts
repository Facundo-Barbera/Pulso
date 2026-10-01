import { replan } from "@/src/calendar/schedule";
import { addBusyBlock, listBusyBlocks } from "@/src/calendar/store";
import { deviceOf, unpaired } from "../../auth";
import { body, params, respond } from "../respond";

export const dynamic = "force-dynamic";

/** `[?from&to]` → `{ blocks: BusyBlock[] }` (definitions; the timeline has the occurrences). */
export function GET(request: Request): Promise<Response> {
  if (!deviceOf(request)) return Promise.resolve(unpaired());
  const query = params(request);
  return respond(() => ({ blocks: listBusyBlocks({ from: query.get("from") ?? undefined, to: query.get("to") ?? undefined }) }));
}

/** Body: `BusyBlockInput`. → `{ block, replan }`. */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const input = await body(request);
  return respond(() => ({ block: addBusyBlock(input), replan: replan() }));
}
