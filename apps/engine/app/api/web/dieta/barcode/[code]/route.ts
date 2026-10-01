import { lookupBarcode, normalizeBarcode } from "@/src/nutrition/barcode";
import { json } from "../../../http";
import { invalid } from "../../http";

export const dynamic = "force-dynamic";

/** `{ product }` from Open Food Facts (cached), `{ product: null }` when unknown, 502 when unreachable. */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }): Promise<Response> {
  const code = normalizeBarcode((await params).code);
  if (!code) return invalid("El código debe tener de 8 a 14 dígitos.");
  try {
    return json({ product: await lookupBarcode(code) });
  } catch {
    return json({ code: "lookup_failed", message: "No se pudo consultar Open Food Facts." }, 502);
  }
}
