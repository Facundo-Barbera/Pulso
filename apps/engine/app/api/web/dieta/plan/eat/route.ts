import { z } from "zod";
import { dateString } from "@/src/nutrition/inputs";
import { eatPlanItems, eatSlot } from "@/src/web/dieta";
import { json } from "../../../http";
import { body } from "../../http";

export const dynamic = "force-dynamic";

const schema = z.union([z.object({ slotId: z.string().min(1) }), z.object({ itemIds: z.array(z.string()).min(1).max(60), date: dateString })]);

/**
 * `{ slotId }`: «Me lo comí» — logs that dated slot as planned. `{ itemIds, date }`:
 * "Comí lo del plan" — logs the items of the active plan not yet eaten that day.
 */
export async function POST(request: Request): Promise<Response> {
  const input = await body(request, schema);
  if (input instanceof Response) return input;
  return json({ meals: "slotId" in input ? eatSlot(input.slotId) : eatPlanItems(input.itemIds, input.date) });
}
