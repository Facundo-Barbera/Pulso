import { threadFromBrief } from "@/src/coach/reply";
import { getBrief } from "@/src/coach/store";
import { deviceOf, NO_STORE, unpaired } from "../../../../auth";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** "Responder": a new conversation that opens with this brief as the Coach's first message. */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const { id } = await params;
  const brief = getBrief(id);
  if (!brief?.text) return Response.json({ code: "not_found", message: "No such brief." }, { status: 404, headers: NO_STORE });
  return Response.json({ thread: threadFromBrief(brief) }, { status: 201, headers: NO_STORE });
}
