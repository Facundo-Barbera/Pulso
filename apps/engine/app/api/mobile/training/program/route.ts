import { activeProgramView } from "@/src/training/store";
import { deviceOf, NO_STORE, unpaired } from "../../auth";

export const dynamic = "force-dynamic";

/** `ActiveProgramResponse`: the active program, the day to train next and a load suggestion per exercise. */
export function GET(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  return Response.json(activeProgramView(), { headers: NO_STORE });
}
