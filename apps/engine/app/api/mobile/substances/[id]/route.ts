import { deleteUse, updateUse } from "@/src/substances/store";
import { deviceOf, unpaired } from "../../auth";
import { body, respond } from "../respond";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** Body: `SubstanceEntryPatch` → the updated `SubstanceEntry`. */
export async function PATCH(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const { id } = await params;
  const patch = await body(request);
  return respond(() => updateUse(id, patch));
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const { id } = await params;
  return respond(() => {
    deleteUse(id);
    return { deleted: id };
  });
}
