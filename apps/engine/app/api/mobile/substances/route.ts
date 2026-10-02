import type { Substance } from "@pulso/contract";
import { logUse, SUBSTANCES } from "@/src/substances/store";
import { substanceOverview } from "@/src/substances/summary";
import { deviceOf, unpaired } from "../auth";
import { asOf } from "../medication/respond";
import { body, respond } from "./respond";

export const dynamic = "force-dynamic";

/** `?substance=cannabis&date=&time=` → `SubstanceOverview` as of the phone's local day. */
export function GET(request: Request): Promise<Response> {
  if (!deviceOf(request)) return Promise.resolve(unpaired());
  const param = new URL(request.url).searchParams.get("substance");
  const substance: Substance = SUBSTANCES.includes(param as Substance) ? (param as Substance) : "cannabis";
  return respond(() => substanceOverview(substance, asOf(request).date));
}

/** Body: `SubstanceEntryInput` → the new `SubstanceEntry`. */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const input = await body(request);
  return respond(() => logUse(input));
}
