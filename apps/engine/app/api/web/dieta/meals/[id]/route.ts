import { deleteMeal } from "@/src/nutrition/store";
import { replaceMeal } from "@/src/web/dieta";
import { json } from "../../../http";
import { body, invalid } from "../../http";
import { toWebMeal, webMealSchema } from "../schema";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** The whole corrected entry (same body as POST). Returns `{ meal }` with its new id. */
export async function PUT(request: Request, { params }: Context): Promise<Response> {
  const input = await body(request, webMealSchema);
  if (input instanceof Response) return input;
  const meal = toWebMeal(input);
  if (typeof meal === "string") return invalid(meal);
  const updated = replaceMeal((await params).id, meal);
  return updated ? json({ meal: updated }) : invalid("no such entry", 404);
}

export async function DELETE(_request: Request, { params }: Context): Promise<Response> {
  return deleteMeal((await params).id) ? json({ ok: true }) : invalid("no such entry", 404);
}
