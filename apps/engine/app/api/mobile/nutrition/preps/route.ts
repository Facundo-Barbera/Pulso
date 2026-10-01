import { prepViews, requirePlan } from "@/src/nutrition/horizon";
import { deviceOf, unpaired } from "../../auth";
import { diet } from "../http";

export const dynamic = "force-dynamic";

/** Every prep batch of the active plan, `{ preps: PrepBatch[] }` (portions, leftovers, status). Changes go through plan/ops. */
export function GET(request: Request): Promise<Response> | Response {
  if (!deviceOf(request)) return unpaired();
  return diet(() => ({ preps: prepViews(requirePlan().id) }));
}
