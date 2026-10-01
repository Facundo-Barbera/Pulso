import { getShoppingList } from "@/src/shopping/store";
import { deviceOf, unpaired } from "../auth";
import { respond } from "./respond";

export const dynamic = "force-dynamic";

/** The current `ShoppingList`. */
export function GET(request: Request): Promise<Response> {
  if (!deviceOf(request)) return Promise.resolve(unpaired());
  return respond(() => getShoppingList());
}
