import { setMealTimesFor, setPreferences } from "@/src/calendar/store";
import { deviceOf, unpaired } from "../../auth";
import { body, respond } from "../respond";

export const dynamic = "force-dynamic";

/** Body: `{ mealTimes: MealTime[], dates?: string[] }`. Without dates they become the default. */
export async function PUT(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const input = (await body(request)) as { mealTimes?: unknown; dates?: string[] } | undefined;
  return respond(() =>
    input?.dates?.length ? { byDate: setMealTimesFor(input.dates, input.mealTimes) } : { preferences: setPreferences({ mealTimes: input?.mealTimes }) },
  );
}
