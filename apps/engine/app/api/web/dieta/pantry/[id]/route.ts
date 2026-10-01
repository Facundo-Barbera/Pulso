import { removePantryItems, updatePantryItem } from "@/src/shopping/pantry";
import { diet } from "../../http";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

/** Body: `{ name?, quantity?, unit?, expiresOn? }` (quantity 0 = ran out). Returns `{ items }`. */
export async function PATCH(request: Request, { params }: Context): Promise<Response> {
  const { id } = await params;
  const patch = await request.json().catch(() => undefined);
  return diet(() => ({ items: updatePantryItem(id, patch) }));
}

/** Returns `{ items }` without it. */
export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  const { id } = await params;
  return diet(() => ({ items: removePantryItems([id]) }));
}
