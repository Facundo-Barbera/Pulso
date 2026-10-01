import { z } from "zod";
import { addPantryItems, listPantry } from "@/src/shopping/pantry";
import { deviceOf, unpaired } from "../../auth";
import { diet } from "../http";

export const dynamic = "force-dynamic";

/** `{ items: PantryItem[] }`: what is at home. */
export function GET(request: Request): Promise<Response> | Response {
  if (!deviceOf(request)) return unpaired();
  return diet(() => ({ items: listPantry() }));
}

/** Body `{ items: PantryInput[] }`. Returns `{ items }`. */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const input = await request.json().catch(() => undefined);
  return diet(() => ({ items: addPantryItems(z.object({ items: z.array(z.unknown()).min(1).max(50) }).parse(input).items) }));
}
