import { setSleepTargetMin } from "@/src/sleep/store";
import { json } from "../../http";

export const dynamic = "force-dynamic";

/** `{ minutes }` between 4 h and 12 h → `{ targetMin }`. */
export async function PUT(request: Request): Promise<Response> {
  const minutes = ((await request.json().catch(() => undefined)) as { minutes?: unknown } | undefined)?.minutes;
  if (typeof minutes !== "number" || !(minutes >= 240 && minutes <= 720)) return json({ code: "invalid_request", message: "El objetivo tiene que estar entre 4 y 12 horas." }, 400);
  return json({ targetMin: setSleepTargetMin(minutes) });
}
