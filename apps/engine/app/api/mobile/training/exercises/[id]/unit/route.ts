import { z } from "zod";
import { weightUnitEnum } from "@/src/training/inputs";
import { setExerciseUnit, TrainingError } from "@/src/training/store";
import { deviceOf, NO_STORE, unpaired } from "../../../../auth";

export const dynamic = "force-dynamic";

const body = z.object({ unit: weightUnitEnum.nullable() });

/** `{ unit }` pins the exercise to kg or lb; null follows the default unit again. Returns `TrainingSettings`. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const parsed = body.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return Response.json({ code: "invalid_request", message: 'expected { unit: "kg" | "lb" | null }' }, { status: 400, headers: NO_STORE });
  try {
    return Response.json(setExerciseUnit((await params).id, parsed.data.unit), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof TrainingError) return Response.json({ code: "not_found", message: "No existe ese ejercicio." }, { status: 404, headers: NO_STORE });
    throw error;
  }
}
