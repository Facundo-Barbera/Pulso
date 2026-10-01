import { lookupBarcode, normalizeBarcode } from "@/src/nutrition/barcode";
import { deviceOf, NO_STORE, unpaired } from "../../../auth";
import { invalid, ok } from "../../http";

export const dynamic = "force-dynamic";

/** `{ product }` from Open Food Facts (cached), `{ product: null }` when unknown, 502 when unreachable. */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const code = normalizeBarcode((await params).code);
  if (!code) return invalid("barcode must be 8 to 14 digits");
  try {
    return ok({ product: await lookupBarcode(code) });
  } catch {
    return Response.json({ code: "lookup_failed", message: "No se pudo consultar Open Food Facts." }, { status: 502, headers: NO_STORE });
  }
}
