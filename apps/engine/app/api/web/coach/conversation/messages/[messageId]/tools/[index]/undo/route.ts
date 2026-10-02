import type { AgentUndoResponse } from "@pulso/contract";
import { conversationThreadId } from "@/src/agent/conversation";
import { UndoError, undoToolAction } from "@/src/agent/undo";
import { json } from "../../../../../../../http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ messageId: string; index: string }> };

/** Deshacer on an action card: puts the change back and answers with the message, its card marked undone. */
export async function POST(_request: Request, { params }: Context): Promise<Response> {
  const { messageId, index } = await params;
  try {
    const body: AgentUndoResponse = { message: undoToolAction(conversationThreadId(), messageId, Number(index)) };
    return json(body);
  } catch (error) {
    if (!(error instanceof UndoError)) throw error;
    return json({ code: error.status === 404 ? "not_found" : "conflict", message: error.message }, error.status);
  }
}
