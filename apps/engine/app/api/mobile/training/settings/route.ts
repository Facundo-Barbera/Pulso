import { z } from "zod";
import { equipmentEnum, weightUnitEnum } from "@/src/training/inputs";
import { setTrainingSettings, trainingSettings } from "@/src/training/store";
import { deviceOf, NO_STORE, unpaired } from "../../auth";

export const dynamic = "force-dynamic";

/** `TrainingSettings`. */
export function GET(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  return Response.json(trainingSettings(), { headers: NO_STORE });
}

// Older phones send only preferredEquipment; anything else in the body (exerciseUnits) is ignored.
const body = z.object({ preferredEquipment: z.array(equipmentEnum).max(7).optional(), defaultUnit: weightUnitEnum.optional() });

/** Changes the settings given; returns them all as stored. */
export async function PUT(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const parsed = body.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return Response.json({ code: "invalid_request", message: 'expected { preferredEquipment?: Equipment[], defaultUnit?: "kg" | "lb" }' }, { status: 400, headers: NO_STORE });
  return Response.json(setTrainingSettings(parsed.data), { headers: NO_STORE });
}
