import { attachmentResponse } from "@/src/agent/attachments";
import { conversationThreadId } from "@/src/agent/conversation";
import { json } from "../../../../http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ attachmentId: string }> };

/** A photo sent in the conversation, as a JPEG. */
export async function GET(_request: Request, { params }: Context): Promise<Response> {
  return attachmentResponse(conversationThreadId(), (await params).attachmentId) ?? json({ code: "not_found", message: "Esa foto ya no existe." }, 404);
}
