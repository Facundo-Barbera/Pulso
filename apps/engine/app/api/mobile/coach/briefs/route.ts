import { listBriefs } from "@/src/coach/store";
import { deviceOf, NO_STORE, unpaired } from "../../auth";

export const dynamic = "force-dynamic";

/** History, newest first. `?kind=daily|weekly` filters; `?limit=` (1–100, default 30). */
export function GET(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  if (kind !== null && kind !== "daily" && kind !== "weekly") {
    return Response.json({ code: "invalid_request", message: "kind must be daily or weekly" }, { status: 400, headers: NO_STORE });
  }
  const limit = Math.min(100, Math.max(1, Number(params.get("limit")) || 30));
  return Response.json({ briefs: listBriefs(kind ?? undefined, limit) }, { headers: NO_STORE });
}
