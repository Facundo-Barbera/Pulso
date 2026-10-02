import type { Substance } from "@pulso/contract";
import { logUse, SUBSTANCES } from "@/src/substances/store";
import { substanceOverview } from "@/src/substances/summary";
import { body, hidden, respond } from "./respond";

export const dynamic = "force-dynamic";

/** `?s=cannabis|alcohol|nicotina` → `SubstanceOverview`. */
export function GET(request: Request): Response {
  const refused = hidden(request);
  if (refused) return refused;
  const param = new URL(request.url).searchParams.get("s");
  return respond(() => substanceOverview(SUBSTANCES.includes(param as Substance) ? (param as Substance) : "cannabis"));
}

/** Body: `SubstanceEntryInput` → the new `SubstanceEntry`. */
export async function POST(request: Request): Promise<Response> {
  const refused = hidden(request);
  if (refused) return refused;
  const input = await body(request);
  return respond(() => logUse(input));
}
