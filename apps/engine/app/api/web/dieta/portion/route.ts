import { lookupBarcode } from "@/src/nutrition/barcode";
import { portionFor } from "@/src/nutrition/portion";
import { json } from "../../http";

export const dynamic = "force-dynamic";

/** `{ barcode, amount }` («una cucharada», «la mitad») → `{ estimate: PortionEstimate }`; 400 unreadable, 404 unknown product, 502 unreachable. */
export async function POST(request: Request): Promise<Response> {
  const result = await portionFor(await request.json().catch(() => undefined), (code) => lookupBarcode(code));
  if (result.status === 200) return json({ estimate: result.estimate });
  const { status, ...error } = result;
  return json(error, status);
}
