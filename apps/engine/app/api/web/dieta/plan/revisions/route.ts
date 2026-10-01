import { requirePlan } from "@/src/nutrition/horizon";
import { listRevisions } from "@/src/nutrition/revisions";
import { diet, intParam, invalid } from "../../http";

export const dynamic = "force-dynamic";

/** `?limit=` (default 20): the active plan's changes, newest first, `{ revisions: PlanRevision[] }`. */
export function GET(request: Request): Promise<Response> | Response {
  const limit = intParam(request, "limit", 1, 100);
  if (limit === null) return invalid("limit must be 1–100");
  return diet(() => ({ revisions: listRevisions(requirePlan().id, limit) }));
}
