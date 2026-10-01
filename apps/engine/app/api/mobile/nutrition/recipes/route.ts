import { createRecipe, listRecipes } from "@/src/nutrition/recipes";
import { deviceOf, unpaired } from "../../auth";
import { diet } from "../http";

export const dynamic = "force-dynamic";

/** `{ recipes: Recipe[] }`, newest first. */
export function GET(request: Request): Promise<Response> | Response {
  if (!deviceOf(request)) return unpaired();
  return diet(() => ({ recipes: listRecipes() }));
}

/** Body: `RecipeInput`. Returns `{ recipe }`. */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const input = await request.json().catch(() => undefined);
  return diet(() => ({ recipe: createRecipe(input) }));
}
