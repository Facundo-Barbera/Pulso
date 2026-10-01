import { setSleepTargetMin } from "@/src/sleep/store";
import { deviceOf, NO_STORE, unpaired } from "../../auth";

export const dynamic = "force-dynamic";

/** `{ minutes }` between 4 h and 12 h. */
export async function PUT(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const minutes = ((await request.json().catch(() => undefined)) as { minutes?: unknown } | undefined)?.minutes;
  if (typeof minutes !== "number" || !(minutes >= 240 && minutes <= 720)) {
    return Response.json({ code: "invalid_request", message: "expected { minutes } between 240 and 720" }, { status: 400 });
  }
  return Response.json({ targetMin: setSleepTargetMin(minutes) }, { headers: NO_STORE });
}
