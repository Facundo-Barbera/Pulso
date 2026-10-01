import { attachmentResponse } from "@/src/agent/attachments";
import { deviceOf, NO_STORE, unpaired } from "../../../../../auth";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; attachmentId: string }> };

/** A photo sent in this thread, as a JPEG. */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const { id, attachmentId } = await params;
  return attachmentResponse(id, attachmentId) ?? Response.json({ code: "not_found", message: "No such photo." }, { status: 404, headers: NO_STORE });
}
