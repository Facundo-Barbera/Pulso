import { logDishFrom, logDishSchema } from "@/src/nutrition/dish-api";
import { body, diet } from "../../http";

export const dynamic = "force-dynamic";

/** Crear platillo: `{ name?, components, slot?, eatenAt? | time?, date?, slotId? }`. Returns `{ meals }`, its entries. */
export async function POST(request: Request): Promise<Response> {
  const input = await body(request, logDishSchema);
  if (input instanceof Response) return input;
  return diet(() => logDishFrom(input));
}
