import { getRecipe } from "@/src/nutrition/recipes";
import { deviceOf, unpaired } from "../../../auth";
import { diet } from "../../http";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

/** `{ recipe }`. */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const { id } = await params;
  return diet(() => ({ recipe: getRecipe(id) }));
}
