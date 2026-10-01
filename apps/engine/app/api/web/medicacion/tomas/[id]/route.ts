import { undoDose } from "@/src/medication/store";
import { respond, type IdContext } from "../../respond";

export const dynamic = "force-dynamic";

/** Undoes a logged dose: the slot is pending again and a taken dose returns to stock. */
export async function DELETE(_request: Request, { params }: IdContext): Promise<Response> {
  const { id } = await params;
  return respond(() => {
    undoDose(id);
    return { undone: id };
  });
}
