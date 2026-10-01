import { eventStream, NDJSON_HEADERS } from "@/src/agent/ndjson";
import { subscribe } from "@/src/agent/runner";
import { sendMessage } from "@/src/agent/send";
import { getThread } from "@/src/agent/threads";
import { json } from "../../../../http";
import { notFound, type Context } from "../../../respond";

export const dynamic = "force-dynamic";

/**
 * Sends `{ text }` (or multipart `text` + up to 4 `image` files) and streams
 * the Coach's turn as NDJSON `AgentStreamEvent`s, the same runner the phone
 * uses. The turn runs to the end and is saved even if the browser goes away.
 */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  const { id } = await params;
  if (!getThread(id)) return notFound();
  const sent = await sendMessage(id, request);
  if (!("turn" in sent)) return json({ code: sent.code, message: sent.message }, sent.status);
  const { turn } = sent;
  return new Response(eventStream((emit) => subscribe(turn, emit)), { headers: NDJSON_HEADERS });
}
