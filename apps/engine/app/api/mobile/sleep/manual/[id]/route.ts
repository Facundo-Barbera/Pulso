import { deleteManualNight, parseManualPatch, updateManualNight } from "@/src/sleep/manual";
import { invalid, respond } from "@/src/sleep/respond";
import { deviceOf, unpaired } from "../../../auth";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** `ManualSleepPatch` → the updated `ManualSleepNight`. */
export async function PATCH(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const { id } = await params;
  const patch = parseManualPatch(await request.json().catch(() => undefined));
  if (!patch) return invalid();
  return respond(() => updateManualNight(id, patch));
}

/** → the deleted `ManualSleepNight`. */
export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const { id } = await params;
  return respond(() => deleteManualNight(id));
}
