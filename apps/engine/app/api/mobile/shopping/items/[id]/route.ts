import { removeShoppingItems, updateShoppingItem } from "@/src/shopping/store";
import { deviceOf, unpaired } from "../../../auth";
import { body, respond } from "../../respond";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** Body: `ShoppingItemPatch`. Returns the `ShoppingList`. */
export async function PATCH(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const { id } = await params;
  const patch = await body(request);
  return respond(() => updateShoppingItem(id, patch));
}

/** Returns the `ShoppingList` without the item. */
export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const { id } = await params;
  return respond(() => removeShoppingItems([id]));
}
