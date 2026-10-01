import { DATE } from "@/src/medication/schedule";
import { dosesBetween, logDose } from "@/src/medication/store";
import { deviceOf, NO_STORE, unpaired } from "../../auth";
import { body, respond } from "../respond";

export const dynamic = "force-dynamic";

/** `?from=YYYY-MM-DD&to=YYYY-MM-DD[&medicationId=]` → `{ doses: DoseEvent[] }`. */
export function GET(request: Request): Promise<Response> {
  if (!deviceOf(request)) return Promise.resolve(unpaired());
  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  if (!DATE.test(from) || !DATE.test(to)) {
    return Promise.resolve(Response.json({ code: "invalid_request", message: "expected ?from=YYYY-MM-DD&to=YYYY-MM-DD" }, { status: 400, headers: NO_STORE }));
  }
  return respond(() => ({ doses: dosesBetween(from, to, params.get("medicationId") ?? undefined) }));
}

/** Body: `DoseLogInput`. Returns the `DoseEvent`. */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const input = await body(request);
  return respond(() => logDose(input));
}
