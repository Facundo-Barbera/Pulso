import { attachmentResponse } from "@/src/agent/attachments";
import { json } from "../../../../../http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; attachmentId: string }> };

/** A photo sent in this thread, as a JPEG. */
export async function GET(_request: Request, { params }: Context): Promise<Response> {
  const { id, attachmentId } = await params;
  return attachmentResponse(id, attachmentId) ?? json({ code: "not_found", message: "Esa foto ya no existe." }, 404);
}
