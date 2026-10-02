import { reorderSubstances } from "@/src/substances/store";
import { deviceOf, unpaired } from "../../../auth";
import { body, respond } from "../../respond";

export const dynamic = "force-dynamic";

/** Body: `SubstanceOrder` (every active id) → `{ substances: Substance[] }`. */
export async function PUT(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const input = (await body(request)) as { ids?: unknown } | undefined;
  return respond(() => ({ substances: reorderSubstances(input?.ids) }));
}
