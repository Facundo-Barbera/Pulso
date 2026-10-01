import { BODY_METRICS } from "@pulso/contract";
import { z } from "zod";
import { projection, setGoal } from "@/src/body/store";
import { json } from "../../http";
import { invalid } from "../issues";

export const dynamic = "force-dynamic";

const goalSchema = z.object({ metric: z.enum(BODY_METRICS), target: z.number().positive().max(400).nullable() });

/** `{ metric, target }` sets the goal (kg or %); `target: null` clears it. Answers with the metric's fresh projection. */
export async function PUT(request: Request): Promise<Response> {
  const parsed = goalSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return invalid(parsed.error);
  return json({ goal: setGoal(parsed.data.metric, parsed.data.target), projection: projection(parsed.data.metric) });
}
