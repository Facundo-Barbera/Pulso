import { z } from "zod";
import { setExerciseNotes, TrainingError } from "@/src/training/store";
import { deviceOf, NO_STORE, unpaired } from "../../../../auth";

export const dynamic = "force-dynamic";

const body = z.object({ notes: z.string().max(4000).nullable() });

/** `{ notes }` replaces the person's notes on the exercise; blank or null clears them. Returns `{ notes }` as stored. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const parsed = body.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return Response.json({ code: "invalid_request", message: "expected { notes: string | null }" }, { status: 400, headers: NO_STORE });
  try {
    return Response.json({ notes: setExerciseNotes((await params).id, parsed.data.notes) }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof TrainingError) return Response.json({ code: "not_found", message: "No existe ese ejercicio." }, { status: 404, headers: NO_STORE });
    throw error;
  }
}
