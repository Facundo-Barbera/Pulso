import { updateSettings } from "@/src/substances/store";
import { body, hidden, respond } from "../respond";

export const dynamic = "force-dynamic";

/** Body: `SubstanceSettingsPatch` (`maxDaysPerWeek: null` clears it) → `SubstanceSettings`. */
export async function PATCH(request: Request): Promise<Response> {
  const refused = hidden(request);
  if (refused) return refused;
  const patch = await body(request);
  return respond(() => updateSettings(patch));
}
