import type { CoachBriefs } from "@pulso/contract";
import { nudgeCoachScheduler } from "@/src/coach/scheduler";
import { latestBrief } from "@/src/coach/store";
import { deviceOf, NO_STORE, unpaired } from "../../auth";

export const dynamic = "force-dynamic";

/** The latest brief of each kind. Also nudges the scheduler: the phone opening is a good moment to write a due one. */
export function GET(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  nudgeCoachScheduler();
  const body: CoachBriefs = { daily: latestBrief("daily"), weekly: latestBrief("weekly") };
  return Response.json(body, { headers: NO_STORE });
}
