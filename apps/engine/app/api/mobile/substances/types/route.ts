import { createSubstance, listSubstances } from "@/src/substances/store";
import { deviceOf, unpaired } from "../../auth";
import { body, respond } from "../respond";

export const dynamic = "force-dynamic";

/** `{ substances: Substance[] }`: active by position, then archived. */
export function GET(request: Request): Promise<Response> {
  if (!deviceOf(request)) return Promise.resolve(unpaired());
  return respond(() => ({ substances: listSubstances() }));
}

/** Body: `SubstanceInput` → the new `Substance` (201). */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const input = await body(request);
  return respond(() => createSubstance(input), 201);
}
