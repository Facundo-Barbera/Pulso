import { conversationTurn } from "@/src/agent/feed";
import { eventStream, NDJSON_HEADERS } from "@/src/agent/ndjson";
import { stopTurn, subscribe } from "@/src/agent/runner";
import { json } from "../../../http";

export const dynamic = "force-dynamic";

const noTurn = () => json({ code: "no_turn", message: "No hay ninguna respuesta en curso." }, 404);

/** Re-attaches to the turn in flight (replayed from its start), or 404 when none is running. */
export function GET(): Response {
  const turn = conversationTurn();
  if (!turn) return noTurn();
  return new Response(eventStream((emit) => subscribe(turn, emit)), { headers: NDJSON_HEADERS });
}

/** Stop: ends the turn, keeping what it wrote. Its stream closes with `done` (or `error` if nothing was written). */
export function DELETE(): Response {
  const turn = conversationTurn();
  return turn && stopTurn(turn.threadId) ? new Response(null, { status: 204 }) : noTurn();
}
