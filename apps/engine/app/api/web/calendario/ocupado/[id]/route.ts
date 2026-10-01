import { replan } from "@/src/calendar/schedule";
import { deleteBusyBlock, updateBusyBlock } from "@/src/calendar/store";
import { body, respond, type IdContext } from "../../respond";

export const dynamic = "force-dynamic";

/** Body: `BusyBlockPatch` → `{ block, replan }`. */
export async function PATCH(request: Request, { params }: IdContext): Promise<Response> {
  const { id } = await params;
  const patch = await body(request);
  return respond(() => ({ block: updateBusyBlock(id, patch), replan: replan() }));
}

/** → `{ removed, replan }`. */
export async function DELETE(_request: Request, { params }: IdContext): Promise<Response> {
  const { id } = await params;
  return respond(() => ({ removed: deleteBusyBlock(id), replan: replan() }));
}
