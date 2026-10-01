import { sessionInput } from "@/src/training/inputs";
import { saveSession, TrainingError } from "@/src/training/store";
import { json } from "../../http";

export const dynamic = "force-dynamic";

/**
 * A session logged in the web app (`SessionInput`), saved through the same
 * store as the phone's: upserted by its client-made id, so a retry is safe.
 * Returns `SessionSaved` with any records.
 */
export async function POST(request: Request): Promise<Response> {
  const parsed = sessionInput.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return json({ code: "invalid_request", message: "expected SessionInput" }, 400);
  try {
    return json(saveSession(parsed.data));
  } catch (error) {
    if (error instanceof TrainingError) return json({ code: "invalid_request", message: error.message }, 400);
    throw error;
  }
}
