import { deleteWater } from "@/src/nutrition/water";
import { deviceOf, unpaired } from "../../../auth";
import { invalid, ok } from "../../http";

export const dynamic = "force-dynamic";

/** Undo: removes one water entry. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const { id } = await params;
  return deleteWater(id) ? ok({ deleted: id }) : invalid("no such water entry", 404);
}
