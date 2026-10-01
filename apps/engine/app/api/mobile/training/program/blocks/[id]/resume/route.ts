import { programWithMedia } from "@/src/training/media";
import { resumeBlock, TrainingError } from "@/src/training/store";
import { deviceOf, NO_STORE, unpaired } from "../../../../../auth";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** "Retomar": a new active block with that earlier block's days. Returns `ActiveProgramResponse`. */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  try {
    return Response.json(programWithMedia(resumeBlock((await params).id)), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof TrainingError) return Response.json({ code: "invalid_request", message: error.message }, { status: 400, headers: NO_STORE });
    throw error;
  }
}
