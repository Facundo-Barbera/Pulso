import { attachmentResponse } from "@/src/agent/attachments";
import { conversationThreadId } from "@/src/agent/conversation";
import { deviceOf, NO_STORE, unpaired } from "../../../../auth";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ attachmentId: string }> };

/** A photo sent in the conversation, as a JPEG. */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  return attachmentResponse(conversationThreadId(), (await params).attachmentId) ?? Response.json({ code: "not_found", message: "No such photo." }, { status: 404, headers: NO_STORE });
}
