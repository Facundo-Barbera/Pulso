import type { DailyResponse } from "@pulso/contract";
import { addDays, isDate, localDate } from "@/src/daily/dates";
import { listDailyMetrics, parseDailyInputs, readinessFor, upsertDailyMetrics } from "@/src/daily/store";
import { deviceOf, NO_STORE, unpaired } from "../auth";

export const dynamic = "force-dynamic";

const invalid = (message: string) => Response.json({ code: "invalid_request", message }, { status: 400 });

/** `?to=YYYY-MM-DD&days=30`: the days up to `to` (default today, the Mac's date) and readiness for `to`. */
export function GET(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  const params = new URL(request.url).searchParams;
  const to = params.get("to") ?? localDate();
  const days = Number(params.get("days") ?? 30);
  if (!isDate(to) || !Number.isInteger(days) || days < 1 || days > 400) return invalid("expected ?to=YYYY-MM-DD&days=1..400");
  const body: DailyResponse = { days: listDailyMetrics(addDays(to, -(days - 1)), to), readiness: readinessFor(to) };
  return Response.json(body, { headers: NO_STORE });
}

/** HealthKit sync: `{ days: DailyMetricsInput[] }`, upserted by date. */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const inputs = parseDailyInputs(await request.json().catch(() => undefined));
  if (!inputs) return invalid("expected { days: DailyMetricsInput[] }");
  return Response.json({ written: upsertDailyMetrics(inputs) }, { headers: NO_STORE });
}
