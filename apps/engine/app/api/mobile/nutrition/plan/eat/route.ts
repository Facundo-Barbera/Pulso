import { z } from "zod";
import { dateString } from "@/src/nutrition/inputs";
import { eatPlanItem } from "@/src/nutrition/store";
import { eatSlot } from "@/src/web/dieta";
import { deviceOf, unpaired } from "../../../auth";
import { body, invalid, ok } from "../../http";

export const dynamic = "force-dynamic";

const schema = z.union([z.object({ slotId: z.string().min(1) }), z.object({ itemId: z.string(), date: dateString.optional() })]);

/**
 * `{ slotId }`: «Me lo comí» on a dated slot — logs what it holds now, linked to it.
 * Prep portions share item ids across slots, so eating by item id could tick
 * another meal. `{ itemId, date? }`: the older "comido" tap, kept for older builds.
 */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const input = await body(request, schema);
  if (input instanceof Response) return input;
  if ("slotId" in input) {
    const meals = eatSlot(input.slotId);
    return meals.length ? ok({ meals }) : invalid("slot is not pending in the active plan", 404);
  }
  const meal = eatPlanItem(input.itemId, input.date);
  return meal ? ok({ meal }) : invalid("item is not in the active plan", 404);
}
