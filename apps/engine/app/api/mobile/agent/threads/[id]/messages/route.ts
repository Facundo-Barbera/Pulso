import { eventStream, NDJSON_HEADERS } from "@/src/agent/ndjson";
import { startTurn, subscribe } from "@/src/agent/runner";
import { getThread } from "@/src/agent/threads";
import { deviceOf, NO_STORE, unpaired } from "../../../../auth";

export const dynamic = "force-dynamic";

const MAX_TEXT = 8000;

type Context = { params: Promise<{ id: string }> };

/**
 * Sends `{ text }` and streams the Coach's turn as NDJSON `AgentStreamEvent`s.
 * The turn runs to the end and is saved even if the phone hangs up; the
 * finished message can be re-read from `GET /threads/:id`.
 */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const { id } = await params;
  if (!getThread(id)) return Response.json({ code: "not_found", message: "No such conversation." }, { status: 404, headers: NO_STORE });
  const body = (await request.json().catch(() => undefined)) as { text?: unknown } | undefined;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > MAX_TEXT) {
    return Response.json({ code: "invalid_request", message: `expected { text } with 1–${MAX_TEXT} characters` }, { status: 400, headers: NO_STORE });
  }
  let turn;
  try {
    ({ turn } = startTurn(id, text));
  } catch {
    return Response.json({ code: "busy", message: "The Coach is still answering in this conversation." }, { status: 409, headers: NO_STORE });
  }
  return new Response(eventStream((emit) => subscribe(turn, emit)), { headers: NDJSON_HEADERS });
}
