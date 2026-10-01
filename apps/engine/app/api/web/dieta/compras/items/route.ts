import { addShoppingItems } from "@/src/shopping/store";
import { shopping } from "../../http";

export const dynamic = "force-dynamic";

/** Body: `ShoppingItemInput`. Returns the `ShoppingList` with it. */
export async function POST(request: Request): Promise<Response> {
  const input = await request.json().catch(() => undefined);
  return shopping(() => addShoppingItems([input]));
}
