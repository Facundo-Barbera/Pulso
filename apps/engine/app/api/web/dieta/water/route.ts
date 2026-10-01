import { z } from "zod";
import { dateString } from "@/src/nutrition/inputs";
import { logWater, waterDay } from "@/src/nutrition/water";
import { json } from "../../http";
import { body } from "../http";

export const dynamic = "force-dynamic";

/** `{ amountMl, date }`: a glass, a bottle or another amount. Returns the entry and the updated day. */
export async function POST(request: Request): Promise<Response> {
  const input = await body(request, z.object({ amountMl: z.number().positive().max(5000), date: dateString }));
  if (input instanceof Response) return input;
  const entry = logWater(input);
  return json({ entry, day: waterDay(entry.date) });
}
