import { updatePlannedSession } from "@/src/calendar/schedule";
import { deviceOf, unpaired } from "../../../auth";
import { body, respond, type IdContext } from "../../respond";

export const dynamic = "force-dynamic";

/** Body: `PlannedSessionPatch`. → `PlannedSession`. */
export async function PATCH(request: Request, { params }: IdContext): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const { id } = await params;
  const patch = await body(request);
  return respond(() => updatePlannedSession(id, patch ?? {}));
}
