import { forgetDevice } from "@/src/devices";
import { json, loopbackOnly } from "../../../http";

export const dynamic = "force-dynamic";

/** Revokes a device: its token stops working at once. The Mac only. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const refused = loopbackOnly(request);
  if (refused) return refused;
  const { id } = await params;
  return forgetDevice(id) ? json({ ok: true }) : json({ code: "not_found", message: "No hay un dispositivo con ese id." }, 404);
}
