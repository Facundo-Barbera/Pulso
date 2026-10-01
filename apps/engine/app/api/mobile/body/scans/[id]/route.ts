import { deleteScan } from "@/src/body/store";
import { deviceOf, NO_STORE, unpaired } from "../../../auth";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const { id } = await params;
  if (!deleteScan(id)) return Response.json({ code: "not_found", message: "No existe esa medición." }, { status: 404 });
  return Response.json({ deleted: id }, { headers: NO_STORE });
}
