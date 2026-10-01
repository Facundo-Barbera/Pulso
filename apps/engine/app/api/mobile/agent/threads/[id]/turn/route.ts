import { eventStream, NDJSON_HEADERS } from "@/src/agent/ndjson";
import { activeTurn, subscribe } from "@/src/agent/runner";
import { deviceOf, NO_STORE, unpaired } from "../../../../auth";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** Re-attaches to the turn in flight (replayed from its start), or 404 when none is running. */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const { id } = await params;
  const turn = activeTurn(id);
  if (!turn) return Response.json({ code: "no_turn", message: "Nothing is running in this conversation." }, { status: 404, headers: NO_STORE });
  return new Response(eventStream((emit) => subscribe(turn, emit)), { headers: NDJSON_HEADERS });
}
