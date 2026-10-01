import { deleteMeal } from "@/src/nutrition/store";
import { deviceOf, unpaired } from "../../../auth";
import { invalid, ok } from "../../http";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const { id } = await params;
  return deleteMeal(id) ? ok({ deleted: id }) : invalid("no such meal", 404);
}
