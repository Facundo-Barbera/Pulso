import { updateSubstance } from "@/src/substances/store";
import { body, hidden, respond } from "../../respond";

export const dynamic = "force-dynamic";

/** Body: `SubstancePatch` (incl. `archived`, `maxDaysPerWeek`) → `Substance`. Nothing is ever deleted. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const refused = hidden(request);
  if (refused) return refused;
  const { id } = await params;
  const patch = await body(request);
  return respond(() => updateSubstance(id, patch));
}
