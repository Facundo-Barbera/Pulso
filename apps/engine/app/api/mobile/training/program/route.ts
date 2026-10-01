import { programWithMedia } from "@/src/training/media";
import { nudgeReviews } from "@/src/training/review";
import { activeProgramView } from "@/src/training/store";
import { deviceOf, NO_STORE, unpaired } from "../../auth";

export const dynamic = "force-dynamic";

/** `ActiveProgramResponse`: the active program, the day to train next and a load suggestion per exercise. */
export function GET(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  // Opening Entreno catches up a review of the next workout that is due.
  nudgeReviews();
  return Response.json(programWithMedia(activeProgramView()), { headers: NO_STORE });
}
