import { saveDishFrom, saveDishSchema } from "@/src/nutrition/dish-api";
import { listSavedDishes } from "@/src/nutrition/dishes";
import { deviceOf, unpaired } from "../../auth";
import { body, diet } from "../http";

export const dynamic = "force-dynamic";

/** `{ dishes: SavedDish[] }` (Mis platillos), most used first. */
export function GET(request: Request): Promise<Response> | Response {
  if (!deviceOf(request)) return unpaired();
  return diet(() => ({ dishes: listSavedDishes() }));
}

/** Saves a dish: `{ loggedDishId, name?, slot? }` (Guardar como platillo), `{ recipeId, name?, slot? }` or `{ name, slot?, components }`. Returns `{ dish }`. */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const input = await body(request, saveDishSchema);
  if (input instanceof Response) return input;
  return diet(() => saveDishFrom(input));
}
