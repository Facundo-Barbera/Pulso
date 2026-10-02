import { deleteUse, updateUse } from "@/src/substances/store";
import { body, hidden, respond } from "../respond";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** Body: `SubstanceEntryPatch` → the updated `SubstanceEntry`. */
export async function PATCH(request: Request, { params }: Context): Promise<Response> {
  const refused = hidden(request);
  if (refused) return refused;
  const { id } = await params;
  const patch = await body(request);
  return respond(() => updateUse(id, patch));
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  const refused = hidden(request);
  if (refused) return refused;
  const { id } = await params;
  return respond(() => {
    deleteUse(id);
    return { deleted: id };
  });
}
