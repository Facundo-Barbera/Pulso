import { replyToBrief } from "@/src/coach/reply";
import { getBrief } from "@/src/coach/store";
import { deviceOf, NO_STORE, unpaired } from "../../../../auth";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** «Responder»: the brief goes into the conversation as the Coach's message. Answers `{ message }`. */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const brief = getBrief((await params).id);
  if (!brief?.text) return Response.json({ code: "not_found", message: "No such brief." }, { status: 404, headers: NO_STORE });
  return Response.json({ message: replyToBrief(brief) }, { status: 201, headers: NO_STORE });
}
