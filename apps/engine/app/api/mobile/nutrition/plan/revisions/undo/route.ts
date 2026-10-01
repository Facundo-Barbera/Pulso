import { z } from "zod";
import { undo } from "@/src/nutrition/ops";
import { deviceOf, unpaired } from "../../../../auth";
import { diet } from "../../../http";

export const dynamic = "force-dynamic";

/** Body `{ id? }`: undoes that change, or the latest. Returns the `PlanChange`. */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const input = await request.json().catch(() => ({}));
  return diet(() => undo(z.object({ id: z.string().optional() }).parse(input ?? {}).id));
}
