import { z } from "zod";
import { dateString } from "@/src/nutrition/inputs";
import { localDate } from "@/src/nutrition/store";
import { logWater, waterDay } from "@/src/nutrition/water";
import { deviceOf, unpaired } from "../../auth";
import { body, dateParam, invalid, ok } from "../http";

export const dynamic = "force-dynamic";

/** The water drunk on `?date=` (default today), the goal and the person's units. */
export function GET(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  const date = dateParam(request);
  if (date === null) return invalid("date must be YYYY-MM-DD");
  return ok(waterDay(date ?? localDate()));
}

const schema = z.object({
  amountMl: z.number().positive().max(5000),
  loggedAt: z.number().int().positive().optional(),
  date: dateString.optional(),
});

/** `{ amountMl, loggedAt?, date? }`: a tap on a glass or bottle. Returns the entry and the updated day. */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const input = await body(request, schema);
  if (input instanceof Response) return input;
  const entry = logWater(input);
  return ok({ entry, day: waterDay(entry.date) });
}
