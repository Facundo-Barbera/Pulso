import { generateShoppingList } from "@/src/shopping/store";
import { deviceOf, unpaired } from "../../auth";
import { body, respond } from "../respond";

export const dynamic = "force-dynamic";

/** Body: `ShoppingGenerateInput` (`from` is the phone's local today). Returns the `ShoppingList`; 409 `no_plan` without an active plan. */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const input = await body(request);
  return respond(() => generateShoppingList(input));
}
