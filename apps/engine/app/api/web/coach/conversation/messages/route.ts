import { sendToConversation } from "@/src/agent/feed";
import { eventStream, NDJSON_HEADERS } from "@/src/agent/ndjson";
import { subscribe } from "@/src/agent/runner";
import { json } from "../../../http";

export const dynamic = "force-dynamic";

/**
 * Sends `{ text }` (or multipart `text` + up to 4 `image` files) into the active
 * context and streams the Coach's turn as NDJSON `AgentStreamEvent`s, the same
 * runner the phone uses. The turn runs to the end even if the browser goes away.
 */
export async function POST(request: Request): Promise<Response> {
  const sent = await sendToConversation(request);
  if (!("turn" in sent)) return json({ code: sent.code, message: sent.message }, sent.status);
  const { turn } = sent;
  return new Response(eventStream((emit) => subscribe(turn, emit)), { headers: NDJSON_HEADERS });
}
