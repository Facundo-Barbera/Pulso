import { reorderSubstances } from "@/src/substances/store";
import { body, hidden, respond } from "../../respond";

export const dynamic = "force-dynamic";

/** Body: `SubstanceOrder` → `Substance[]`. */
export async function PUT(request: Request): Promise<Response> {
  const refused = hidden(request);
  if (refused) return refused;
  const input = (await body(request)) as { ids?: unknown } | undefined;
  return respond(() => reorderSubstances(input?.ids));
}
