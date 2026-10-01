import { nudgeReviews } from "@/src/training/review";
import { entrenoOverview } from "@/src/web/entreno";
import { json } from "../http";

export const dynamic = "force-dynamic";

/** `EntrenoOverview`: the active program's days and the training history, for a client refresh. */
export function GET(): Response {
  nudgeReviews();
  return json(entrenoOverview());
}
