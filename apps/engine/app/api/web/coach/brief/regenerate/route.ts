import { periodFor } from "@/src/coach/periods";
import { regenerateBrief } from "@/src/coach/scheduler";
import { briefFor } from "@/src/coach/store";
import { json } from "../../../http";

export const dynamic = "force-dynamic";

/** `{ kind? }` (default daily): rewrites the current brief in the background. 202 with the `running` brief; poll `GET …/brief`. */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { kind?: unknown } | undefined;
  const kind = body?.kind ?? "daily";
  if (kind !== "daily" && kind !== "weekly") return json({ code: "invalid_request", message: "kind debe ser daily o weekly." }, 400);
  const started = regenerateBrief(kind);
  return json({ brief: started?.brief ?? briefFor(kind, periodFor(kind, new Date())) ?? null }, 202);
}
