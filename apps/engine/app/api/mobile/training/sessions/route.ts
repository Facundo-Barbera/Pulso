import { sessionInput } from "@/src/training/inputs";
import { listSessions, saveSession, TrainingError } from "@/src/training/store";
import { deviceOf, NO_STORE, unpaired } from "../../auth";

export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  return Response.json({ sessions: listSessions(30) }, { headers: NO_STORE });
}

/** A finished session (`SessionInput`), upserted by its client-made id. Returns `SessionSaved` with any PRs. */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const parsed = sessionInput.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return Response.json({ code: "invalid_request", message: "expected SessionInput" }, { status: 400, headers: NO_STORE });
  try {
    return Response.json(saveSession(parsed.data), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof TrainingError) return Response.json({ code: "invalid_request", message: error.message }, { status: 400, headers: NO_STORE });
    throw error;
  }
}
