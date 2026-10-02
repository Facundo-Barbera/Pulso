import type { AgentUndoResponse } from "@pulso/contract";
import { conversationThreadId } from "@/src/agent/conversation";
import { UndoError, undoToolAction } from "@/src/agent/undo";
import { deviceOf, NO_STORE, unpaired } from "../../../../../../../auth";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ messageId: string; index: string }> };

/** Deshacer on an action card: puts the change back and answers with the message, its card marked undone. */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const { messageId, index } = await params;
  try {
    const body: AgentUndoResponse = { message: undoToolAction(conversationThreadId(), messageId, Number(index)) };
    return Response.json(body, { headers: NO_STORE });
  } catch (error) {
    if (!(error instanceof UndoError)) throw error;
    return Response.json({ code: error.status === 404 ? "not_found" : "conflict", message: error.message }, { status: error.status, headers: NO_STORE });
  }
}
