import { BODY_METRICS } from "@pulso/contract";
import { z } from "zod";
import { projection, setGoal } from "@/src/body/store";
import { deviceOf, NO_STORE, unpaired } from "../../auth";

export const dynamic = "force-dynamic";

const goalSchema = z.object({ metric: z.enum(BODY_METRICS), target: z.number().positive().max(400).nullable() });

/** `{ metric, target }` sets the goal; `target: null` clears it. Answers with the metric's fresh projection. */
export async function PUT(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const parsed = goalSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return Response.json({ code: "invalid_request", message: "expected { metric, target }" }, { status: 400 });
  const goal = setGoal(parsed.data.metric, parsed.data.target);
  return Response.json({ goal, projection: projection(parsed.data.metric) }, { headers: NO_STORE });
}
