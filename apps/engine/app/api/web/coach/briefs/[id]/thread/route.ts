import { threadFromBrief } from "@/src/coach/reply";
import { getBrief } from "@/src/coach/store";
import { json } from "../../../../http";
import { type Context } from "../../../respond";

export const dynamic = "force-dynamic";

/** "Responder": a new conversation that opens with this brief as the Coach's first message. */
export async function POST(_request: Request, { params }: Context): Promise<Response> {
  const brief = getBrief((await params).id);
  if (!brief?.text) return json({ code: "not_found", message: "Ese resumen ya no existe." }, 404);
  return json({ thread: threadFromBrief(brief) }, 201);
}
