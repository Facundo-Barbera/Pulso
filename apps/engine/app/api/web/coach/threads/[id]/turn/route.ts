import { eventStream, NDJSON_HEADERS } from "@/src/agent/ndjson";
import { activeTurn, stopTurn, subscribe } from "@/src/agent/runner";
import { json } from "../../../../http";
import { type Context } from "../../../respond";

export const dynamic = "force-dynamic";

const noTurn = () => json({ code: "no_turn", message: "No hay ninguna respuesta en curso." }, 404);

/** Re-attaches to the turn in flight (replayed from its start), or 404 when none is running. */
export async function GET(_request: Request, { params }: Context): Promise<Response> {
  const turn = activeTurn((await params).id);
  if (!turn) return noTurn();
  return new Response(eventStream((emit) => subscribe(turn, emit)), { headers: NDJSON_HEADERS });
}

/** Stop: ends the turn, keeping what it wrote. Its stream closes with `done` (or `error` if nothing was written). */
export async function DELETE(_request: Request, { params }: Context): Promise<Response> {
  return stopTurn((await params).id) ? new Response(null, { status: 204 }) : noTurn();
}
