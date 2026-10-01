import { bodyOverview } from "@/src/web/cuerpo";
import { json } from "../http";

export const dynamic = "force-dynamic";

/** `BodyOverview`: everything the Cuerpo page draws, for a client refresh. */
export function GET(): Response {
  return json(bodyOverview());
}
