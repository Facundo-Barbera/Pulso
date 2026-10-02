import { logUse } from "@/src/substances/store";
import { substanceOverview } from "@/src/substances/summary";
import { body, hidden, respond } from "./respond";

export const dynamic = "force-dynamic";

/** `?s=<id|all>` → `SubstanceOverview`; default the first active substance. */
export function GET(request: Request): Response {
  const refused = hidden(request);
  if (refused) return refused;
  return respond(() => substanceOverview(new URL(request.url).searchParams.get("s")));
}

/** Body: `SubstanceEntryInput` → the new `SubstanceEntry`. */
export async function POST(request: Request): Promise<Response> {
  const refused = hidden(request);
  if (refused) return refused;
  const input = await body(request);
  return respond(() => logUse(input));
}
