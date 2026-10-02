import { updateSubstance } from "@/src/substances/store";
import { deviceOf, unpaired } from "../../../auth";
import { body, respond } from "../../respond";

export const dynamic = "force-dynamic";

/** Body: `SubstancePatch` (name, symbol, unit, forms, maxDaysPerWeek, archived) → `Substance`. Nothing is ever deleted. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const { id } = await params;
  const patch = await body(request);
  return respond(() => updateSubstance(id, patch));
}
