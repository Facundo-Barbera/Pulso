import { ConversationError, returnToContext } from "@/src/agent/feed";
import { deviceOf, NO_STORE, unpaired } from "../../../../auth";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** «Volver a este contexto»: makes it active again. Answers with the conversation's latest page. */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  try {
    return Response.json(returnToContext((await params).id), { headers: NO_STORE });
  } catch (error) {
    if (!(error instanceof ConversationError)) throw error;
    return Response.json({ code: error.code, message: error.message }, { status: error.status, headers: NO_STORE });
  }
}
