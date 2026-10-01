import { adjustmentThreadId, TrainingError } from "@/src/training/store";
import { deviceOf, NO_STORE, unpaired } from "../../../../../auth";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** "Ver por qué" → `{ threadId }`: a Coach thread that opens with the review, to discuss it. */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  try {
    return Response.json({ threadId: adjustmentThreadId((await params).id) }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof TrainingError) return Response.json({ code: "not_found", message: error.message }, { status: 404, headers: NO_STORE });
    throw error;
  }
}
