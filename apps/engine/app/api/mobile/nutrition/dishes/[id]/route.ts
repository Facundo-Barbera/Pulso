import { updateDishFrom, updateDishSchema } from "@/src/nutrition/dish-api";
import { deleteSavedDish } from "@/src/nutrition/dishes";
import { deviceOf, unpaired } from "../../../auth";
import { body, diet, invalid } from "../../http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** `{ name?, slot?, components? }` (components replace the old ones). Returns `{ dish }`. */
export async function PUT(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const input = await body(request, updateDishSchema);
  if (input instanceof Response) return input;
  const { id } = await params;
  return diet(() => updateDishFrom(id, input));
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const { id } = await params;
  return deleteSavedDish(id) ? diet(() => ({ deleted: id })) : invalid("no such dish", 404);
}
