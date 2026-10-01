import { z } from "zod";
import { dateString } from "@/src/nutrition/inputs";
import { eatPlanItem } from "@/src/nutrition/store";
import { deviceOf, unpaired } from "../../../auth";
import { body, invalid, ok } from "../../http";

export const dynamic = "force-dynamic";

/** `{ itemId, date? }`: the "comido" tap, logging an item of the active plan. */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const input = await body(request, z.object({ itemId: z.string(), date: dateString.optional() }));
  if (input instanceof Response) return input;
  const meal = eatPlanItem(input.itemId, input.date);
  return meal ? ok({ meal }) : invalid("item is not in the active plan", 404);
}
