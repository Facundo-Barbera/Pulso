import { sendToConversation } from "@/src/agent/feed";
import { eventStream, NDJSON_HEADERS } from "@/src/agent/ndjson";
import { subscribe } from "@/src/agent/runner";
import { deviceOf, NO_STORE, unpaired } from "../../../auth";

export const dynamic = "force-dynamic";

/**
 * Sends `{ text, barcodes? }` (or multipart `text` + up to 4 `image` files) into
 * the active context and streams the Coach's turn as NDJSON `AgentStreamEvent`s.
 * The turn runs to the end and is saved even if the phone hangs up.
 */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const sent = await sendToConversation(request);
  if (!("turn" in sent)) return Response.json({ code: sent.code, message: sent.message }, { status: sent.status, headers: NO_STORE });
  const { turn } = sent;
  return new Response(eventStream((emit) => subscribe(turn, emit)), { headers: NDJSON_HEADERS });
}
