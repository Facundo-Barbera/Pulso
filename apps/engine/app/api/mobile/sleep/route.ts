import { parseSleepInputs, sleepOverview, upsertSleepSegments } from "@/src/sleep/store";
import { deviceOf, NO_STORE, unpaired } from "../auth";

export const dynamic = "force-dynamic";

/** `SleepOverview`: the last 60 nights (newest first) and the 14-night summary. */
export function GET(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  return Response.json(sleepOverview(), { headers: NO_STORE });
}

/** HealthKit sync: `{ segments: SleepSegmentInput[] }`. Each (night, source) in the batch replaces what was stored. */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const inputs = parseSleepInputs(await request.json().catch(() => undefined));
  if (!inputs) return Response.json({ code: "invalid_request", message: "expected { segments: SleepSegmentInput[] }" }, { status: 400 });
  return Response.json({ nights: upsertSleepSegments(inputs).length }, { headers: NO_STORE });
}
