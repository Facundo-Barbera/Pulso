import { getSettings, updateSettings } from "@/src/substances/store";
import { deviceOf, unpaired } from "../../auth";
import { body, respond } from "../respond";

export const dynamic = "force-dynamic";

/** `SubstanceSettings`. */
export function GET(request: Request): Promise<Response> {
  if (!deviceOf(request)) return Promise.resolve(unpaired());
  return respond(() => getSettings());
}

/** Body: `SubstanceSettingsPatch` (`maxDaysPerWeek: null` clears the goal) → `SubstanceSettings`. */
export async function PATCH(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const patch = await body(request);
  return respond(() => updateSettings(patch));
}
