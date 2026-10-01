import { replan } from "@/src/calendar/schedule";
import { deleteHealthEvent, updateHealthEvent } from "@/src/calendar/store";
import { local } from "@/src/calendar/time";
import { deviceOf, unpaired } from "../../../auth";
import { body, respond, type IdContext } from "../../respond";

export const dynamic = "force-dynamic";

/** Body: `HealthEventPatch`. → `{ event, replan }`. */
export async function PATCH(request: Request, { params }: IdContext): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const { id } = await params;
  const patch = await body(request);
  return respond(() => ({ event: updateHealthEvent(id, patch, local().date), replan: replan() }));
}

/** → `{ removed, replan }`. */
export async function DELETE(request: Request, { params }: IdContext): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const { id } = await params;
  return respond(() => ({ removed: deleteHealthEvent(id), replan: replan() }));
}
