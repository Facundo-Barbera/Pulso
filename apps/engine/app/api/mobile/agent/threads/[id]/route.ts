import type { AgentThreadDetail } from "@pulso/contract";
import { activeTurn } from "@/src/agent/runner";
import { deleteThread, getThread, listMessages } from "@/src/agent/threads";
import { removeWorkspace } from "@/src/agent/workspace";
import { deviceOf, NO_STORE, unpaired } from "../../../auth";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const notFound = () => Response.json({ code: "not_found", message: "No such conversation." }, { status: 404, headers: NO_STORE });

/** The thread and all its messages. A message still being written has status `streaming`. */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const { id } = await params;
  const thread = getThread(id);
  if (!thread) return notFound();
  const detail: AgentThreadDetail & { running: boolean } = { thread, messages: listMessages(id), running: !!activeTurn(id) };
  return Response.json(detail, { headers: NO_STORE });
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const { id } = await params;
  if (activeTurn(id)) return Response.json({ code: "busy", message: "The Coach is still answering in this conversation." }, { status: 409, headers: NO_STORE });
  if (!deleteThread(id)) return notFound();
  removeWorkspace(id);
  return new Response(null, { status: 204 });
}
