import { replyToBrief } from "@/src/coach/reply";
import { getBrief } from "@/src/coach/store";
import { json } from "../../../../http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** «Responder»: the brief goes into the conversation as the Coach's message. Answers `{ message }`. */
export async function POST(_request: Request, { params }: Context): Promise<Response> {
  const brief = getBrief((await params).id);
  if (!brief?.text) return json({ code: "not_found", message: "Ese resumen ya no existe." }, 404);
  return json({ message: replyToBrief(brief) }, 201);
}
