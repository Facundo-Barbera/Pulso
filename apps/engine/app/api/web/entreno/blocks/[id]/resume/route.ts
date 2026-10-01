import { resumeBlock, TrainingError } from "@/src/training/store";
import { entrenoOverview } from "@/src/web/entreno";
import { json } from "../../../../http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** "Retomar" an earlier block. Returns the refreshed `EntrenoOverview`. */
export async function POST(_request: Request, { params }: Context): Promise<Response> {
  try {
    resumeBlock((await params).id);
    return json(entrenoOverview());
  } catch (error) {
    if (error instanceof TrainingError) return json({ code: "invalid_request", message: error.message }, 400);
    throw error;
  }
}
