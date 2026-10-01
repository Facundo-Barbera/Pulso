import { createRecipe, listRecipes } from "@/src/nutrition/recipes";
import { diet } from "../http";

export const dynamic = "force-dynamic";

/** `{ recipes: Recipe[] }`, newest first. */
export function GET(): Promise<Response> | Response {
  return diet(() => ({ recipes: listRecipes() }));
}

/** Body: `RecipeInput`. Returns `{ recipe }`. */
export async function POST(request: Request): Promise<Response> {
  const input = await request.json().catch(() => undefined);
  return diet(() => ({ recipe: createRecipe(input) }));
}
