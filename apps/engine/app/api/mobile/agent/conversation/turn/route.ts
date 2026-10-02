import { conversationTurn } from "@/src/agent/feed";
import { eventStream, NDJSON_HEADERS } from "@/src/agent/ndjson";
import { stopTurn, subscribe } from "@/src/agent/runner";
import { deviceOf, NO_STORE, unpaired } from "../../../auth";

export const dynamic = "force-dynamic";

const noTurn = () => Response.json({ code: "no_turn", message: "Nothing is running in the conversation." }, { status: 404, headers: NO_STORE });

/** Re-attaches to the turn in flight (replayed from its start), or 404 when none is running. */
export function GET(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  const turn = conversationTurn();
  if (!turn) return noTurn();
  return new Response(eventStream((emit) => subscribe(turn, emit)), { headers: NDJSON_HEADERS });
}

/** Stop: ends the turn, keeping what it wrote. */
export function DELETE(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  const turn = conversationTurn();
  return turn && stopTurn(turn.threadId) ? new Response(null, { status: 204 }) : noTurn();
}
