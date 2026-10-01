import { saveDishFrom, saveDishSchema } from "@/src/nutrition/dish-api";
import { listSavedDishes } from "@/src/nutrition/dishes";
import { body, diet } from "../http";

export const dynamic = "force-dynamic";

/** `{ dishes: SavedDish[] }` (Mis platillos), most used first. */
export function GET(): Promise<Response> | Response {
  return diet(() => ({ dishes: listSavedDishes() }));
}

/** Saves a dish: `{ loggedDishId, name?, slot? }` (Guardar como platillo), `{ recipeId, name?, slot? }` or `{ name, slot?, components }`. Returns `{ dish }`. */
export async function POST(request: Request): Promise<Response> {
  const input = await body(request, saveDishSchema);
  if (input instanceof Response) return input;
  return diet(() => saveDishFrom(input));
}
