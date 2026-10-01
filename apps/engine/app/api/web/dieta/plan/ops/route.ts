import { runOp } from "@/src/nutrition/api";
import { diet } from "../../http";

export const dynamic = "force-dynamic";

/**
 * Body: `{ op, ...fields }` — skip, replace, rebalance, spread, ingredient_unavailable,
 * no_time_to_cook, move, swap_days, fill, schedule_prep, prep_cooked, use_leftover
 * (fields in src/nutrition/plan-inputs.ts). Returns the `PlanChange` (an ingredient
 * without substitute returns a preview instead).
 */
export async function POST(request: Request): Promise<Response> {
  const input = await request.json().catch(() => undefined);
  return diet(() => runOp(input));
}
