import { ConversationError, returnToContext } from "@/src/agent/feed";
import { json } from "../../../../http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** «Volver a este contexto»: makes it active again. Answers with the conversation's latest page. */
export async function POST(_request: Request, { params }: Context): Promise<Response> {
  try {
    return json(returnToContext((await params).id));
  } catch (error) {
    if (!(error instanceof ConversationError)) throw error;
    return json({ code: error.code, message: error.message }, error.status);
  }
}
