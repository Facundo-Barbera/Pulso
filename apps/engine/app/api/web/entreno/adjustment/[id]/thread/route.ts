import { adjustmentThreadId, TrainingError } from "@/src/training/store";
import { json } from "../../../../http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** "Ver por qué" → `{ threadId }`: a Coach thread that opens with the review. */
export async function POST(_request: Request, { params }: Context): Promise<Response> {
  try {
    return json({ threadId: adjustmentThreadId((await params).id) });
  } catch (error) {
    if (error instanceof TrainingError) return json({ code: "not_found", message: error.message }, 404);
    throw error;
  }
}
