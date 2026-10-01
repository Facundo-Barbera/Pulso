import { z } from "zod";
import { setExerciseNotes, TrainingError } from "@/src/training/store";
import { json } from "../../../../http";

export const dynamic = "force-dynamic";

const body = z.object({ notes: z.string().max(4000).nullable() });

/** `{ notes }` replaces the person's notes on the exercise; blank or null clears them. Returns `{ notes }` as stored. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const parsed = body.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return json({ code: "invalid_request", message: "expected { notes: string | null }" }, 400);
  try {
    return json({ notes: setExerciseNotes((await params).id, parsed.data.notes) });
  } catch (error) {
    if (error instanceof TrainingError) return json({ code: "not_found", message: "No existe ese ejercicio." }, 404);
    throw error;
  }
}
