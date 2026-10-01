import { programWithMedia } from "@/src/training/media";
import { startNextWeek, TrainingError } from "@/src/training/store";
import { deviceOf, NO_STORE, unpaired } from "../../../../auth";

export const dynamic = "force-dynamic";

/** "Empezar la semana ya": begins the next week now, once this one is complete. Returns `ActiveProgramResponse`. */
export function POST(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  try {
    return Response.json(programWithMedia(startNextWeek()), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof TrainingError) return Response.json({ code: "invalid_request", message: error.message }, { status: 409, headers: NO_STORE });
    throw error;
  }
}
