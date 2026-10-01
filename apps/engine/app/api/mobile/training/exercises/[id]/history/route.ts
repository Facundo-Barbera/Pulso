import { exerciseHistory } from "@/src/training/store";
import { deviceOf, NO_STORE, unpaired } from "../../../../auth";

export const dynamic = "force-dynamic";

/** `ExerciseHistory`: one point per session, oldest first, for the phone's chart. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const history = exerciseHistory((await params).id);
  if (!history) return Response.json({ code: "not_found", message: "No existe ese ejercicio." }, { status: 404, headers: NO_STORE });
  return Response.json(history, { headers: NO_STORE });
}
