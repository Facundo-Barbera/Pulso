import { generateShoppingList } from "@/src/shopping/store";
import { shopping } from "../../http";

export const dynamic = "force-dynamic";

/** Body: `ShoppingGenerateInput`. Returns the `ShoppingList`; 409 `no_plan` without an active plan. */
export async function POST(request: Request): Promise<Response> {
  const input = await request.json().catch(() => undefined);
  return shopping(() => generateShoppingList(input));
}
