import { ConversationError, startNewContext } from "@/src/agent/feed";
import { deviceOf, NO_STORE, unpaired } from "../../../auth";

export const dynamic = "force-dynamic";

/** «Contexto nuevo»: the next message starts a fresh session. Answers with the conversation's latest page. */
export function POST(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  try {
    return Response.json(startNewContext(), { status: 201, headers: NO_STORE });
  } catch (error) {
    if (!(error instanceof ConversationError)) throw error;
    return Response.json({ code: error.code, message: error.message }, { status: error.status, headers: NO_STORE });
  }
}
