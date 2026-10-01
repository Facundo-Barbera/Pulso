import { z } from "zod";
import { programWithMedia } from "@/src/training/media";
import { dismissAdjustment, TrainingError } from "@/src/training/store";
import { deviceOf, NO_STORE, unpaired } from "../../../../auth";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const body = z.object({ dismissed: z.boolean() });

/** `{ dismissed }`: "Entrenar normal" for the next session, or back to the Coach's plan. Returns `ActiveProgramResponse`. */
export async function PUT(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const parsed = body.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return Response.json({ code: "invalid_request", message: "expected { dismissed }" }, { status: 400, headers: NO_STORE });
  try {
    return Response.json(programWithMedia(dismissAdjustment((await params).id, parsed.data.dismissed)), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof TrainingError) return Response.json({ code: "not_found", message: error.message }, { status: 404, headers: NO_STORE });
    throw error;
  }
}
