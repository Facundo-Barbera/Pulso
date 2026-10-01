import { z } from "zod";
import { dateString } from "@/src/nutrition/inputs";
import { copyDay } from "@/src/nutrition/store";
import { deviceOf, unpaired } from "../../../auth";
import { body, ok } from "../../http";

export const dynamic = "force-dynamic";

/** `{ from, to }`: copies every entry of `from` onto `to` ("copiar ayer"). */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const input = await body(request, z.object({ from: dateString, to: dateString }));
  if (input instanceof Response) return input;
  return ok({ meals: copyDay(input.from, input.to) });
}
