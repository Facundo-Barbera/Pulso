import { addShoppingItems } from "@/src/shopping/store";
import { deviceOf, unpaired } from "../../auth";
import { body, respond } from "../respond";

export const dynamic = "force-dynamic";

/** Body: `ShoppingItemInput`. Returns the `ShoppingList`. */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const input = await body(request);
  return respond(() => addShoppingItems([input]));
}
