import { startNextWeek, TrainingError } from "@/src/training/store";
import { entrenoOverview } from "@/src/web/entreno";
import { json } from "../../../http";

export const dynamic = "force-dynamic";

/** "Empezar la semana ya". Returns the refreshed `EntrenoOverview`. */
export function POST(): Response {
  try {
    startNextWeek();
    return json(entrenoOverview());
  } catch (error) {
    if (error instanceof TrainingError) return json({ code: "invalid_request", message: error.message }, 409);
    throw error;
  }
}
