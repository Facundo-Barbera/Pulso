import { eventStream, NDJSON_HEADERS } from "@/src/agent/ndjson";
import { startTurn, subscribe } from "@/src/agent/runner";
import { getThread } from "@/src/agent/threads";
import { json } from "../../../../http";
import { busy, notFound, type Context } from "../../../respond";

export const dynamic = "force-dynamic";

const MAX_TEXT = 8000;

/**
 * Sends `{ text }` and streams the Coach's turn as NDJSON `AgentStreamEvent`s,
 * the same runner the phone uses. The turn runs to the end and is saved even
 * if the browser goes away.
 */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  const { id } = await params;
  if (!getThread(id)) return notFound();
  const body = (await request.json().catch(() => undefined)) as { text?: unknown } | undefined;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > MAX_TEXT) return json({ code: "invalid_request", message: `El mensaje debe tener entre 1 y ${MAX_TEXT} caracteres.` }, 400);
  let turn;
  try {
    ({ turn } = startTurn(id, text));
  } catch {
    return busy();
  }
  return new Response(eventStream((emit) => subscribe(turn, emit)), { headers: NDJSON_HEADERS });
}
