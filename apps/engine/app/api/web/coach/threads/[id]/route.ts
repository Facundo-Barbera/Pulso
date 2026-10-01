import { coachThread } from "@/src/web/coach";
import { activeTurn } from "@/src/agent/runner";
import { deleteThread } from "@/src/agent/threads";
import { removeAttachments } from "@/src/agent/attachments";
import { removeWorkspace } from "@/src/agent/workspace";
import { json } from "../../../http";
import { busy, notFound, type Context } from "../../respond";

export const dynamic = "force-dynamic";

/** The thread and all its messages; `running` while a turn is in flight (re-attach with `GET …/turn`). */
export async function GET(_request: Request, { params }: Context): Promise<Response> {
  const detail = coachThread((await params).id);
  return detail ? json(detail) : notFound();
}

export async function DELETE(_request: Request, { params }: Context): Promise<Response> {
  const { id } = await params;
  if (activeTurn(id)) return busy();
  if (!deleteThread(id)) return notFound();
  removeWorkspace(id);
  removeAttachments(id);
  return new Response(null, { status: 204 });
}
