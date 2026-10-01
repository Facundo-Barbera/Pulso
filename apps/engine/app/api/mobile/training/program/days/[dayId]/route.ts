import { z } from "zod";
import { programExerciseShape } from "@/src/training/inputs";
import { programWithMedia } from "@/src/training/media";
import { clearDayOverride, TrainingError, updateProgramDay } from "@/src/training/store";
import { deviceOf, NO_STORE, unpaired } from "../../../../auth";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ dayId: string }> };

const body = z.object({
  scope: z.enum(["today", "always"]),
  exercises: z.array(programExerciseShape.extend({ id: z.string().max(64).nullish() })).min(1).max(20),
});

const invalid = (message: string) => Response.json({ code: "invalid_request", message }, { status: 400, headers: NO_STORE });

/** `DayEdit`: the day's whole list in its new order, solo hoy or para siempre. Returns `ActiveProgramResponse`. */
export async function PUT(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const parsed = body.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return invalid("expected DayEdit { scope, exercises }");
  try {
    return Response.json(programWithMedia(updateProgramDay((await params).dayId, parsed.data)), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof TrainingError) return invalid(error.message);
    throw error;
  }
}

/** Drops today's one-off changes to the day. Returns `ActiveProgramResponse`. */
export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  try {
    return Response.json(programWithMedia(clearDayOverride((await params).dayId)), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof TrainingError) return Response.json({ code: "not_found", message: error.message }, { status: 404, headers: NO_STORE });
    throw error;
  }
}
