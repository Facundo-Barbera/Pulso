import { mealSchema, toMealInput } from "@/src/nutrition/inputs";
import { deleteMeal } from "@/src/nutrition/store";
import { replaceMeal } from "@/src/web/dieta";
import { deviceOf, unpaired } from "../../../auth";
import { body, invalid, ok } from "../../http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** The whole corrected entry (same body as POST); a dish's component keeps its dish, time and meal. Returns `{ meal }` with its new id. */
export async function PUT(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const input = await body(request, mealSchema);
  if (input instanceof Response) return input;
  const meal = toMealInput(input);
  if (typeof meal === "string") return invalid(meal);
  const updated = replaceMeal((await params).id, meal);
  return updated ? ok({ meal: updated }) : invalid("no such meal", 404);
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const { id } = await params;
  return deleteMeal(id) ? ok({ deleted: id }) : invalid("no such meal", 404);
}
