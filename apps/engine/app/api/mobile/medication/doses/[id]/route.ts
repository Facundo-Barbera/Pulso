import { undoDose } from "@/src/medication/store";
import { deviceOf, unpaired } from "../../../auth";
import { respond } from "../../respond";

export const dynamic = "force-dynamic";

/** Undoes a logged dose: the slot is pending again and a taken dose returns to stock. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const { id } = await params;
  return respond(() => {
    undoDose(id);
    return { undone: id };
  });
}
