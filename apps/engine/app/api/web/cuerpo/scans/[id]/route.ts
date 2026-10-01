import { deleteScan } from "@/src/body/store";
import { json } from "../../../http";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return deleteScan(id) ? json({ deleted: id }) : json({ code: "not_found", message: "No existe esa medición." }, 404);
}
