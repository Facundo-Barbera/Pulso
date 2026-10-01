import { liveCoachThread } from "@/src/training/live-coach";
import { deviceOf, NO_STORE, unpaired } from "../../../auth";

export const dynamic = "force-dynamic";

/** `{ threadId }`: the Coach thread bound to the session in progress, created on first use. 404 without one. */
export function POST(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  const threadId = liveCoachThread();
  if (!threadId) return Response.json({ code: "no_session", message: "No hay una sesión en curso en la Mac todavía." }, { status: 404, headers: NO_STORE });
  return Response.json({ threadId }, { headers: NO_STORE });
}
