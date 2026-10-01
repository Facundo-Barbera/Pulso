import { z } from "zod";
import { weightUnitEnum } from "@/src/training/inputs";
import { setTrainingSettings } from "@/src/training/store";
import { json } from "../../http";

export const dynamic = "force-dynamic";

const body = z.object({ defaultUnit: weightUnitEnum });

/** `{ defaultUnit }`: the unit for totals and exercises without their own. Returns `TrainingSettings`. */
export async function PUT(request: Request): Promise<Response> {
  const parsed = body.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return json({ code: "invalid_request", message: 'expected { defaultUnit: "kg" | "lb" }' }, 400);
  return json(setTrainingSettings(parsed.data));
}
