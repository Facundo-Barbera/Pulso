import { sleepPage } from "@/src/web/sleep";
import { json } from "../http";

export const dynamic = "force-dynamic";

/** `[?noche=YYYY-MM-DD]` → `SleepPage`: everything the Sueño page draws. */
export function GET(request: Request): Response {
  return json(sleepPage(new URL(request.url).searchParams.get("noche")));
}
