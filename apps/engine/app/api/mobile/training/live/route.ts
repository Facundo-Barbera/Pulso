import type { LiveSession } from "@pulso/contract";
import { liveSessionInput } from "@/src/training/inputs";
import { clearLive, getLive, putLive } from "@/src/training/live";
import { deviceOf, NO_STORE, unpaired } from "../../auth";

export const dynamic = "force-dynamic";

/** `{ session: LiveSession | null }`: the session in progress as the engine has it. */
export function GET(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  return Response.json({ session: getLive() }, { headers: NO_STORE });
}

/**
 * `{ session, baseVersion }` → `{ session }` with the new version, or 409
 * `{ code: "conflict", session }` when the Coach changed it after `baseVersion`.
 */
export async function PUT(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const parsed = liveSessionInput.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return Response.json({ code: "invalid_request", message: "expected { session: LiveSession, baseVersion }" }, { status: 400, headers: NO_STORE });
  const result = putLive(parsed.data.session as LiveSession, parsed.data.baseVersion);
  if (!result.ok) return Response.json({ code: "conflict", message: "El Coach cambió la sesión.", session: result.session }, { status: 409, headers: NO_STORE });
  return Response.json({ session: result.session }, { headers: NO_STORE });
}

/** Forgets the session in progress (finished or discarded). */
export function DELETE(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  clearLive();
  return Response.json({ ok: true }, { headers: NO_STORE });
}
