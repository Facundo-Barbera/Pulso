import { patchDishFrom, patchDishSchema } from "@/src/nutrition/dish-api";
import { body, diet } from "../../../http";

export const dynamic = "force-dynamic";

/** A dish eaten: `{ name?, add? }` renames it and/or adds components. Returns `{ meals }`, its entries. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const input = await body(request, patchDishSchema);
  if (input instanceof Response) return input;
  const { id } = await params;
  return diet(() => patchDishFrom(id, input));
}
