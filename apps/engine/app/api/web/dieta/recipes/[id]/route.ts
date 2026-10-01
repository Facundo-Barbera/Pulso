import { getRecipe } from "@/src/nutrition/recipes";
import { diet } from "../../http";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

/** `{ recipe }`. */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  const { id } = await params;
  return diet(() => ({ recipe: getRecipe(id) }));
}
