import type { CoachBriefs } from "@pulso/contract";
import { nudgeCoachScheduler } from "@/src/coach/scheduler";
import { latestBrief } from "@/src/coach/store";
import { json } from "../../http";

export const dynamic = "force-dynamic";

/** The latest brief of each kind. Also nudges the scheduler, like the phone opening Hoy. */
export function GET(): Response {
  nudgeCoachScheduler();
  const body: CoachBriefs = { daily: latestBrief("daily"), weekly: latestBrief("weekly") };
  return json(body);
}
