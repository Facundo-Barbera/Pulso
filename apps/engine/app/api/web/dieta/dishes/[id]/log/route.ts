import { logSavedDishFrom, logSavedDishSchema } from "@/src/nutrition/dish-api";
import { body, diet } from "../../../http";

export const dynamic = "force-dynamic";

/** Logs a saved dish: `{ scale?, overrides?, slot?, eatenAt? | time?, date?, slotId? }`. Returns `{ meals }`, its entries. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const input = await body(request, logSavedDishSchema);
  if (input instanceof Response) return input;
  const { id } = await params;
  return diet(() => logSavedDishFrom(id, input));
}
