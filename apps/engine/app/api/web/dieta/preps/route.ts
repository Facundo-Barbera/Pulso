import { prepViews, requirePlan } from "@/src/nutrition/horizon";
import { diet } from "../http";

export const dynamic = "force-dynamic";

/** Every prep batch of the active plan, `{ preps: PrepBatch[] }` (portions, leftovers, status). Changes go through plan/ops. */
export function GET(): Promise<Response> | Response {
  return diet(() => ({ preps: prepViews(requirePlan().id) }));
}
