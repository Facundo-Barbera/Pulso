import { createSubstance } from "@/src/substances/store";
import { body, hidden, respond } from "../respond";

export const dynamic = "force-dynamic";

/** Body: `SubstanceInput` → the new `Substance` (201). */
export async function POST(request: Request): Promise<Response> {
  const refused = hidden(request);
  if (refused) return refused;
  const input = await body(request);
  return respond(() => createSubstance(input), 201);
}
