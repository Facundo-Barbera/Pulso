import { logDose } from "@/src/medication/store";
import { body, respond } from "../respond";

export const dynamic = "force-dynamic";

/** Body: `DoseLogInput` → the `DoseEvent`. A slot's second log overwrites the first. */
export async function POST(request: Request): Promise<Response> {
  const input = await body(request);
  return respond(() => logDose(input));
}
