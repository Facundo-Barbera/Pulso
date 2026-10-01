import { z } from "zod";
import { addDays } from "@/src/nutrition/dates";
import { dateString } from "@/src/nutrition/inputs";
import { copyDay } from "@/src/nutrition/store";
import { json } from "../../../http";
import { body } from "../../http";

export const dynamic = "force-dynamic";

/** `{ date }`: copies the day before onto it. Returns the new entries. */
export async function POST(request: Request): Promise<Response> {
  const input = await body(request, z.object({ date: dateString }));
  if (input instanceof Response) return input;
  return json({ meals: copyDay(addDays(input.date, -1), input.date) });
}
