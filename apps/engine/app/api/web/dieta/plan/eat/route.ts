import { z } from "zod";
import { dateString } from "@/src/nutrition/inputs";
import { eatPlanItems } from "@/src/web/dieta";
import { json } from "../../../http";
import { body } from "../../http";

export const dynamic = "force-dynamic";

/** `{ itemIds, date }`: "Comí lo del plan" — logs the items of the active plan not yet eaten that day. */
export async function POST(request: Request): Promise<Response> {
  const input = await body(request, z.object({ itemIds: z.array(z.string()).min(1).max(60), date: dateString }));
  if (input instanceof Response) return input;
  return json({ meals: eatPlanItems(input.itemIds, input.date) });
}
