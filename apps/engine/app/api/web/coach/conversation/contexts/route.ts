import { ConversationError, startNewContext } from "@/src/agent/feed";
import { json } from "../../../http";

export const dynamic = "force-dynamic";

/** «Contexto nuevo»: the next message starts a fresh session. Answers with the conversation's latest page. */
export function POST(): Response {
  try {
    return json(startNewContext(), 201);
  } catch (error) {
    if (!(error instanceof ConversationError)) throw error;
    return json({ code: error.code, message: error.message }, error.status);
  }
}
