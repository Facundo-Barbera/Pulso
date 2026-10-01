import { exerciseView } from "@/src/web/entreno";
import { json } from "../../../http";

export const dynamic = "force-dynamic";

/** `ExerciseView`: the exercise's guide (muscles, technique, media, videos, notes) and its records. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const view = exerciseView((await params).id);
  return view ? json(view) : json({ code: "not_found", message: "No existe ese ejercicio." }, 404);
}
