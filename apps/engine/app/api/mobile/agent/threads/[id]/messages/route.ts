import { eventStream, NDJSON_HEADERS } from "@/src/agent/ndjson";
import { subscribe } from "@/src/agent/runner";
import { sendMessage } from "@/src/agent/send";
import { getThread } from "@/src/agent/threads";
import { deviceOf, NO_STORE, unpaired } from "../../../../auth";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * Sends `{ text }` (or multipart `text` + up to 4 `image` files) and streams
 * the Coach's turn as NDJSON `AgentStreamEvent`s. The turn runs to the end and
 * is saved even if the phone hangs up; the finished message can be re-read
 * from `GET /threads/:id`.
 */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const { id } = await params;
  if (!getThread(id)) return Response.json({ code: "not_found", message: "No such conversation." }, { status: 404, headers: NO_STORE });
  const sent = await sendMessage(id, request);
  if (!("turn" in sent)) return Response.json({ code: sent.code, message: sent.message }, { status: sent.status, headers: NO_STORE });
  const { turn } = sent;
  return new Response(eventStream((emit) => subscribe(turn, emit)), { headers: NDJSON_HEADERS });
}
