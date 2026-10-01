import { exercisePerformance } from "@/src/training/store";
import { deviceOf, NO_STORE, unpaired } from "../../../../auth";

export const dynamic = "force-dynamic";

/** `ExercisePerformance`: records and one point per session, oldest first. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const result = exercisePerformance((await params).id);
  if (!result) return Response.json({ code: "not_found", message: "No existe ese ejercicio." }, { status: 404, headers: NO_STORE });
  return Response.json(result, { headers: NO_STORE });
}
