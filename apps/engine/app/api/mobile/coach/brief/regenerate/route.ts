import type { CoachBriefKind } from "@pulso/contract";
import { periodFor } from "@/src/coach/periods";
import { regenerateBrief } from "@/src/coach/scheduler";
import { briefFor } from "@/src/coach/store";
import { deviceOf, NO_STORE, unpaired } from "../../../auth";

export const dynamic = "force-dynamic";

/**
 * `{ kind? }` (default daily): rewrites the current period's brief in the
 * background. Answers 202 with the `running` brief at once, also when it was
 * already being written; poll `GET /coach/brief` until it is not `running`.
 */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const body = (await request.json().catch(() => ({}))) as { kind?: unknown } | undefined;
  const kind = body?.kind ?? "daily";
  if (kind !== "daily" && kind !== "weekly") {
    return Response.json({ code: "invalid_request", message: "kind must be daily or weekly" }, { status: 400, headers: NO_STORE });
  }
  const started = regenerateBrief(kind as CoachBriefKind);
  const brief = started?.brief ?? briefFor(kind, periodFor(kind, new Date()));
  return Response.json({ brief }, { status: 202, headers: NO_STORE });
}
