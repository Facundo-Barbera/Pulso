import { lookupBarcode } from "@/src/nutrition/barcode";
import { portionFor } from "@/src/nutrition/portion";
import { deviceOf, NO_STORE, unpaired } from "../../auth";
import { ok } from "../http";

export const dynamic = "force-dynamic";

/** `{ barcode, amount }` («una cucharada», «la mitad») → `{ estimate: PortionEstimate }`; 400 unreadable, 404 unknown product, 502 unreachable. */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const result = await portionFor(await request.json().catch(() => undefined), (code) => lookupBarcode(code));
  if (result.status === 200) return ok({ estimate: result.estimate });
  const { status, ...error } = result;
  return Response.json(error, { status, headers: NO_STORE });
}
