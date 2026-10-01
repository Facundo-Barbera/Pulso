import { exerciseDetail } from "@/src/training/store";
import { deviceOf, NO_STORE, unpaired } from "../../../auth";

export const dynamic = "force-dynamic";

/** `ExerciseDetail`: muscles, technique, media, videos and the person's notes. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const detail = exerciseDetail((await params).id);
  if (!detail) return Response.json({ code: "not_found", message: "No existe ese ejercicio." }, { status: 404, headers: NO_STORE });
  return Response.json(detail, { headers: NO_STORE });
}
