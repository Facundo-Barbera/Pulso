import { getShoppingList } from "@/src/shopping/store";
import { json } from "../../http";

export const dynamic = "force-dynamic";

/** The `ShoppingList`. */
export function GET(): Response {
  return json(getShoppingList());
}
