import { waterSettingsSchema } from "@/src/nutrition/inputs";
import { setWaterSettings } from "@/src/nutrition/water";
import { deviceOf, unpaired } from "../../../auth";
import { body, ok } from "../../http";

export const dynamic = "force-dynamic";

/** Partial update of the goal (null = automatic), preferred unit and glass/bottle sizes. */
export async function PUT(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const input = await body(request, waterSettingsSchema);
  if (input instanceof Response) return input;
  return ok({ settings: setWaterSettings(input) });
}
