import { z } from "zod";
import { weightUnitEnum } from "@/src/training/inputs";
import { setExerciseUnit, TrainingError } from "@/src/training/store";
import { json } from "../../../../http";

export const dynamic = "force-dynamic";

const body = z.object({ unit: weightUnitEnum.nullable() });

/** `{ unit }` pins the exercise to kg or lb (its machine's); null follows the default. Returns `TrainingSettings`. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const parsed = body.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return json({ code: "invalid_request", message: 'expected { unit: "kg" | "lb" | null }' }, 400);
  try {
    return json(setExerciseUnit((await params).id, parsed.data.unit));
  } catch (error) {
    if (error instanceof TrainingError) return json({ code: "not_found", message: "No existe ese ejercicio." }, 404);
    throw error;
  }
}
