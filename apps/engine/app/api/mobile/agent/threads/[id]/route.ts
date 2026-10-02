import type { AgentThreadDetail } from "@pulso/contract";
import { activeTurn } from "@/src/agent/runner";
import { getThread, listMessages } from "@/src/agent/threads";
import { deviceOf, NO_STORE, unpaired } from "../../../auth";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * A thread and all its messages: the live-workout chat (the Coach screen reads
 * `…/agent/conversation` instead). A message still being written has status `streaming`.
 */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const { id } = await params;
  const thread = getThread(id);
  if (!thread) return Response.json({ code: "not_found", message: "No such conversation." }, { status: 404, headers: NO_STORE });
  const detail: AgentThreadDetail & { running: boolean } = { thread, messages: listMessages(id), running: !!activeTurn(id) };
  return Response.json(detail, { headers: NO_STORE });
}
