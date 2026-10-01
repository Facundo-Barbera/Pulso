import { z } from "zod";
import { dismissAdjustment, TrainingError } from "@/src/training/store";
import { entrenoOverview } from "@/src/web/entreno";
import { json } from "../../../http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const body = z.object({ dismissed: z.boolean() });

/** `{ dismissed }`: "Entrenar normal" for the next session, or back to the Coach's plan. Returns `EntrenoOverview`. */
export async function PUT(request: Request, { params }: Context): Promise<Response> {
  const parsed = body.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return json({ code: "invalid_request", message: "expected { dismissed }" }, 400);
  try {
    dismissAdjustment((await params).id, parsed.data.dismissed);
    return json(entrenoOverview());
  } catch (error) {
    if (error instanceof TrainingError) return json({ code: "not_found", message: error.message }, 404);
    throw error;
  }
}
