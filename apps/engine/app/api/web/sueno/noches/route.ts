import { addManualNight, parseManualInput } from "@/src/sleep/manual";
import { invalid, respond } from "@/src/sleep/respond";

export const dynamic = "force-dynamic";

/** Logs a night by hand: `ManualSleepInput` → `ManualSleepNight` (201). 409 when Health measured that night or it was already logged. */
export async function POST(request: Request): Promise<Response> {
  const input = parseManualInput(await request.json().catch(() => undefined));
  if (!input) return invalid();
  return respond(() => addManualNight(input), 201);
}
