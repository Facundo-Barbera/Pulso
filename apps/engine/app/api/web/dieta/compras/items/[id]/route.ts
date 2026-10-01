import { removeShoppingItems, updateShoppingItem } from "@/src/shopping/store";
import { shopping } from "../../../http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** Body: `ShoppingItemPatch` (ticking, «Ya tengo», renaming). Returns the `ShoppingList`. */
export async function PATCH(request: Request, { params }: Context): Promise<Response> {
  const { id } = await params;
  const patch = await request.json().catch(() => undefined);
  return shopping(() => updateShoppingItem(id, patch));
}

export async function DELETE(_request: Request, { params }: Context): Promise<Response> {
  const { id } = await params;
  return shopping(() => removeShoppingItems([id]));
}
